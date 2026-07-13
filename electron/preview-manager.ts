import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import path from 'node:path'

export type PreviewServerState = 'starting' | 'running' | 'stopped' | 'error'

export type PreviewConfiguration = {
  id: string
  name: string
  kind: 'script' | 'static'
  script?: string
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
  framework: string
  port: number
  cwd: string
}

export type PreviewServerStatus = {
  configurationId: string
  state: PreviewServerState
  url?: string
  port?: number
  logs: string[]
  error?: string
}

type PreviewRuntime = {
  configuration: PreviewConfiguration
  state: PreviewServerState
  url: string
  port: number
  logs: string[]
  process?: ChildProcess
  server?: Server
  error?: string
}

const FRONTEND_COMMAND = /(?:^|\s)(vite|next(?:\s+dev)?|astro(?:\s+dev)?|react-scripts\s+start|ng\s+serve|vue-cli-service\s+serve|webpack(?:-dev-server)?)(?:\s|$)/i
const DESKTOP_COMMAND = /(?:electron|tauri|concurrently.*electron)/i
const SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'preview']
const MAX_LOG_LINES = 240

export async function detectPreviewConfigurations(workspacePath: string): Promise<PreviewConfiguration[]> {
  const packagePath = path.join(workspacePath, 'package.json')
  const configurations: PreviewConfiguration[] = []

  if (existsSync(packagePath)) {
    try {
      const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as {
        scripts?: Record<string, unknown>
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
      }
      const scripts = Object.entries(parsed.scripts ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      const packageManager = detectPackageManager(workspacePath)
      const dependencyNames = new Set([
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ])

      const candidates = scripts
        .filter(([name, command]) => isPreviewScript(name, command))
        .sort(([left], [right]) => scriptRank(left) - scriptRank(right) || left.localeCompare(right))

      for (const [script, command] of candidates) {
        const framework = detectFramework(command, dependencyNames)
        configurations.push({
          id: `script:${script}`,
          name: script === 'dev' ? '开发服务器' : `npm 脚本 · ${script}`,
          kind: 'script',
          script,
          packageManager,
          framework,
          port: defaultPort(framework),
          cwd: workspacePath,
        })
      }
    } catch {
      // Invalid package.json is surfaced as no detected script in the UI.
    }
  }

  if (existsSync(path.join(workspacePath, 'index.html'))) {
    configurations.push({
      id: 'static:index',
      name: '静态网页',
      kind: 'static',
      framework: 'static',
      port: 4173,
      cwd: workspacePath,
    })
  }

  return configurations
}

export function isAllowedPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'
      || url.hostname === '::1'
  } catch {
    return false
  }
}

export class PreviewManager {
  private runtimes = new Map<string, PreviewRuntime>()

  async list(workspacePath: string) {
    const configurations = await detectPreviewConfigurations(workspacePath)
    return configurations.map((configuration) => ({
      ...configuration,
      status: this.status(workspacePath, configuration.id),
    }))
  }

  async start(workspacePath: string, configurationId: string): Promise<PreviewServerStatus> {
    const configurations = await detectPreviewConfigurations(workspacePath)
    const configuration = configurations.find((item) => item.id === configurationId)
    if (!configuration) throw new Error('未找到可用的预览配置。')

    const key = runtimeKey(workspacePath, configurationId)
    const existing = this.runtimes.get(key)
    if (existing && (existing.state === 'starting' || existing.state === 'running')) {
      return toStatus(existing)
    }

    const port = await findAvailablePort(configuration.port)
    const runtime: PreviewRuntime = {
      configuration,
      state: 'starting',
      url: `http://127.0.0.1:${port}/`,
      port,
      logs: [],
    }
    this.runtimes.set(key, runtime)

    if (configuration.kind === 'static') {
      await this.startStaticServer(runtime)
    } else {
      this.startScriptServer(runtime)
    }
    return toStatus(runtime)
  }

  status(workspacePath: string, configurationId: string): PreviewServerStatus {
    const runtime = this.runtimes.get(runtimeKey(workspacePath, configurationId))
    return runtime
      ? toStatus(runtime)
      : { configurationId, state: 'stopped', logs: [] }
  }

  async stop(workspacePath: string, configurationId: string) {
    const key = runtimeKey(workspacePath, configurationId)
    const runtime = this.runtimes.get(key)
    if (!runtime) return { configurationId, state: 'stopped' as const, logs: [] }
    await stopRuntime(runtime)
    this.runtimes.delete(key)
    return { configurationId, state: 'stopped' as const, logs: runtime.logs }
  }

  stopAll() {
    const stops = [...this.runtimes.values()].map(stopRuntime)
    this.runtimes.clear()
    return Promise.allSettled(stops)
  }

  private async startStaticServer(runtime: PreviewRuntime) {
    const root = runtime.configuration.cwd
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', runtime.url)
        const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html'
        let filePath = path.resolve(root, relativePath)
        if (!isInside(root, filePath)) {
          response.writeHead(403).end('Forbidden')
          return
        }

        try {
          if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html')
        } catch {
          filePath = path.join(root, 'index.html')
        }

        if (!isInside(root, filePath) || !existsSync(filePath)) {
          response.writeHead(404).end('Not found')
          return
        }
        response.setHeader('Content-Type', contentType(filePath))
        createReadStream(filePath).pipe(response)
      } catch {
        response.writeHead(500).end('Preview server error')
      }
    })

    runtime.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(runtime.port, '127.0.0.1', () => resolve())
    })
    runtime.state = 'running'
    appendLog(runtime, `静态预览已启动：${runtime.url}`)
  }

  private startScriptServer(runtime: PreviewRuntime) {
    const { configuration } = runtime
    if (!configuration.packageManager || !configuration.script) {
      runtime.state = 'error'
      runtime.error = '预览脚本配置不完整。'
      return
    }

    const executable = process.platform === 'win32'
      ? `${configuration.packageManager}.cmd`
      : configuration.packageManager
    const args = packageManagerArgs(configuration.packageManager, configuration.script, frameworkArgs(configuration.framework, runtime.port))
    appendLog(runtime, `正在运行：${executable} ${args.join(' ')}`)

    const child = spawn(executable, args, {
      cwd: configuration.cwd,
      env: {
        ...process.env,
        BROWSER: 'none',
        HOST: '127.0.0.1',
        PORT: String(runtime.port),
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    runtime.process = child

    child.stdout?.on('data', (chunk: Buffer) => appendOutput(runtime, chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendOutput(runtime, chunk))
    child.once('error', (error) => {
      runtime.state = 'error'
      runtime.error = error.message
      appendLog(runtime, error.message)
    })
    child.once('exit', (code, signal) => {
      if (runtime.state !== 'stopped') {
        runtime.state = code === 0 ? 'stopped' : 'error'
        runtime.error = code === 0 ? undefined : `预览服务器退出，退出码 ${code ?? signal ?? 'unknown'}。`
      }
    })

    void waitForPort(runtime.port, child).then(() => {
      if (runtime.state === 'starting') {
        runtime.state = 'running'
        appendLog(runtime, `预览地址：${runtime.url}`)
      }
    }).catch((error) => {
      if (runtime.state === 'starting') {
        runtime.state = 'error'
        runtime.error = error instanceof Error ? error.message : '预览服务器启动失败。'
      }
    })
  }
}

function detectPackageManager(workspacePath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(workspacePath, 'bun.lock')) || existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function isPreviewScript(name: string, command: string) {
  if (DESKTOP_COMMAND.test(command)) return false
  return SCRIPT_PRIORITY.includes(name) || FRONTEND_COMMAND.test(command)
}

function scriptRank(name: string) {
  const exact = SCRIPT_PRIORITY.indexOf(name)
  if (exact >= 0) return exact
  if (name.includes('dev')) return 10
  if (name.includes('serve')) return 11
  return 20
}

function detectFramework(command: string, dependencies: Set<string>) {
  if (/\bnext\b/i.test(command) || dependencies.has('next')) return 'next'
  if (/\bastro\b/i.test(command) || dependencies.has('astro')) return 'astro'
  if (/\bng\s+serve\b/i.test(command) || dependencies.has('@angular/core')) return 'angular'
  if (/react-scripts\s+start/i.test(command) || dependencies.has('react-scripts')) return 'react-scripts'
  if (/vue-cli-service\s+serve/i.test(command) || dependencies.has('@vue/cli-service')) return 'vue-cli'
  if (/webpack(?:-dev-server)?/i.test(command) || dependencies.has('webpack-dev-server')) return 'webpack'
  if (/\bvite\b/i.test(command) || dependencies.has('vite')) return 'vite'
  return 'generic'
}

function defaultPort(framework: string) {
  if (framework === 'vite') return 5173
  if (framework === 'angular') return 4200
  if (framework === 'astro') return 4321
  if (framework === 'vue-cli' || framework === 'webpack') return 8080
  return 3000
}

function frameworkArgs(framework: string, port: number) {
  if (framework === 'next') return ['--hostname', '127.0.0.1', '--port', String(port)]
  if (framework === 'react-scripts' || framework === 'generic') return []
  return ['--host', '127.0.0.1', '--port', String(port)]
}

function packageManagerArgs(packageManager: string, script: string, extraArgs: string[]) {
  if (packageManager === 'yarn') return [script, ...extraArgs]
  return ['run', script, ...(extraArgs.length ? ['--', ...extraArgs] : [])]
}

async function findAvailablePort(preferredPort: number) {
  for (let port = preferredPort; port < preferredPort + 30; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error(`无法在 ${preferredPort}-${preferredPort + 29} 范围内找到可用端口。`)
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function waitForPort(port: number, child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`预览服务器在监听端口前已退出，退出码 ${child.exitCode}。`))
        return
      }
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) reject(new Error(`等待预览端口 ${port} 超时。`))
        else setTimeout(attempt, 300)
      })
    }
    attempt()
  })
}

function appendOutput(runtime: PreviewRuntime, chunk: Buffer) {
  const lines = chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)
  for (const line of lines) {
    if (line.trim()) appendLog(runtime, line)
  }
}

function appendLog(runtime: PreviewRuntime, line: string) {
  runtime.logs.push(line)
  if (runtime.logs.length > MAX_LOG_LINES) runtime.logs.splice(0, runtime.logs.length - MAX_LOG_LINES)
}

async function stopRuntime(runtime: PreviewRuntime) {
  runtime.state = 'stopped'
  if (runtime.server) {
    await new Promise<void>((resolve) => runtime.server?.close(() => resolve()))
  }
  const child = runtime.process
  if (!child?.pid || child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function runtimeKey(workspacePath: string, configurationId: string) {
  return `${path.resolve(workspacePath)}\0${configurationId}`
}

function toStatus(runtime: PreviewRuntime): PreviewServerStatus {
  return {
    configurationId: runtime.configuration.id,
    state: runtime.state,
    url: runtime.url,
    port: runtime.port,
    logs: [...runtime.logs],
    error: runtime.error,
  }
}

function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return types[extension] ?? 'application/octet-stream'
}
