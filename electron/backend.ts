import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createUtf8ProcessEnv,
  resolveWslDistro,
  runWslCommand,
  windowsPathToWslPath,
} from './wsl-paths.js'

// ============================================================================
// Types
// ============================================================================

export type BackendType = 'wsl' | 'native'

export type ProxyConfig = {
  enabled: boolean
  type: string
  host: string
  port: number
}

// ============================================================================
// Interface
// ============================================================================

export interface BackendProvider {
  readonly type: BackendType

  /** Absolute path to ~/.hermes on the backend side. */
  readonly hermesHome: string

  /**
   * Spawn `hermes acp --accept-hooks` on the backend.
   * Returns the raw child process with stdout/stderr piped.
   * The caller owns JSON-RPC protocol, event emission, and lifecycle.
   */
  spawnAcp(
    workspacePath: string,
    proxyConfig: ProxyConfig | null,
  ): Promise<ChildProcessWithoutNullStreams>

  /** Convert a host (Windows) path to a path the backend understands. */
  toBackendPath(hostPath: string): string

  /**
   * Ensure `hermes` is installed and callable on the backend.
   * Must throw if hermes cannot be found or installed.
   */
  ensureHermesInstalled(proxyConfig: ProxyConfig | null): Promise<void>

  /**
   * Execute a command on the backend (e.g. `hermes sessions delete <id>`).
   * The args array is passed directly to spawn/execFile on the target host.
   * Native: spawns `hermes [args]` directly.
   * WSL: runs through `wsl.exe -d <distro> -- bash -lc <command>`.
   */
  execCommand(args: string[]): Promise<string>

  /**
   * Check whether git is available on the backend.
   * WSL: always true (git is bundled with WSL distros).
   * Native: checks for Git for Windows installation.
   */
  gitAvailable(): Promise<boolean>
}

// ============================================================================
// Factory
// ============================================================================

let _backendType: BackendType | null = null
let _backendProvider: BackendProvider | null = null

export function getBackendType(): BackendType {
  if (_backendType) return _backendType

  const raw = (process.env.HERMES_BACKEND ?? 'native').trim().toLowerCase()
  if (raw && raw !== 'native') {
    console.warn(`[backend] HERMES_BACKEND="${raw}" is deprecated; using native backend`)
  }
  _backendType = 'native'
  return _backendType
}

export function getBackendProvider(): BackendProvider {
  if (_backendProvider) return _backendProvider

  const type = getBackendType()
  _backendProvider = type === 'wsl' ? new WslBackendProvider() : new NativeBackendProvider()
  return _backendProvider
}

// ============================================================================
// WSL Backend
// ============================================================================

class WslBackendProvider implements BackendProvider {
  readonly type: BackendType = 'wsl'
  readonly hermesHome = '~/.hermes'

  async spawnAcp(
    workspacePath: string,
    proxyConfig: ProxyConfig | null,
  ): Promise<ChildProcessWithoutNullStreams> {
    const wslWorkspace = windowsPathToWslPath(workspacePath)
    const distro = await resolveWslDistro()

    const exportLines = getProxyExportLines(proxyConfig)
    const shellCmd = [
      'export LANG=C.UTF-8',
      'export LC_ALL=C.UTF-8',
      'export PYTHONUTF8=1',
      'export PYTHONIOENCODING=utf-8',
      'export HERMES_TEXT_ENCODING=utf-8',
      ...exportLines,
      'exec hermes acp --accept-hooks',
    ].join('; ')

    return spawn('wsl.exe', [
      '-d', distro,
      '--cd', wslWorkspace,
      '--', 'bash', '-lc', shellCmd,
    ], {
      stdio: 'pipe',
      windowsHide: true,
      env: createUtf8ProcessEnv({ ...process.env, HERMES_WSL_DISTRO: distro }),
    })
  }

  toBackendPath(hostPath: string): string {
    return windowsPathToWslPath(hostPath)
  }

  async ensureHermesInstalled(proxyConfig: ProxyConfig | null): Promise<void> {
    const distro = await resolveWslDistro()

    // Quick check — is hermes already installed?
    try {
      await runWslCommand([
        'bash', '-lc',
        'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null 2>&1 && hermes --version >/dev/null 2>&1',
      ], distro)
      return // already installed
    } catch {
      // Not found — install below
    }

    // Install via the official install.sh
    const proxyExports = getProxyExportLines(proxyConfig)
    const installerScript = [
      'set -e',
      'export PATH="$HOME/.local/bin:$PATH"',
      'export PYTHONUTF8=1',
      'export PYTHONIOENCODING=utf-8',
      'export LANG=C.UTF-8',
      'export LC_ALL=C.UTF-8',
      ...proxyExports,
      'export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"',
      'export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"',
      'export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"',
      'install_urls="',
      'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      'https://gh-proxy.com/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      'https://ghfast.top/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      '"',
      'installed=0',
      'for url in $install_urls; do',
      '  echo "Trying Hermes installer: $url"',
      '  if curl -fsSL "$url" -o /tmp/hermes-install.sh; then',
      '    bash /tmp/hermes-install.sh',
      '    rm -f /tmp/hermes-install.sh',
      '    installed=1',
      '    break',
      '  fi',
      'done',
      'if [ "$installed" != "1" ]; then',
      '  echo "Unable to download Hermes installer." >&2',
      '  exit 1',
      'fi',
      'command -v hermes >/dev/null 2>&1',
      'hermes --version >/dev/null 2>&1',
    ].join('\n')

    try {
      await runWslCommand(['bash', '-lc', installerScript], distro)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Hermes is not installed in ${distro}, and automatic installation failed. ` +
        `Check WSL network/proxy access, then install Hermes manually and restart. ${detail}`,
      )
    }
  }

  async execCommand(args: string[]): Promise<string> {
    return runWslCommand(['bash', '-lc', args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')])
  }

  async gitAvailable(): Promise<boolean> {
    return true // git is always available inside WSL distros
  }
}

// ============================================================================
// Native Windows Backend
// ============================================================================

class NativeBackendProvider implements BackendProvider {
  readonly type: BackendType = 'native'
  readonly hermesHome: string

  constructor() {
    this.hermesHome = getNativeHermesHome()
  }

  async spawnAcp(
    workspacePath: string,
    proxyConfig: ProxyConfig | null,
  ): Promise<ChildProcessWithoutNullStreams> {
    const env = createNativeHermesEnvironment(this.hermesHome)
    const desktopPythonPath = process.env.HERMES_DESKTOP_PYTHONPATH
    if (desktopPythonPath && existsSync(desktopPythonPath)) {
      env.PYTHONPATH = [desktopPythonPath, env.PYTHONPATH].filter(Boolean).join(path.delimiter)
    }

    if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.port) {
      const protocol = proxyConfig.type === 'socks5' ? 'socks5' : 'http'
      const proxyUrl = `${protocol}://${proxyConfig.host}:${proxyConfig.port}`
      env.http_proxy = proxyUrl
      env.HTTP_PROXY = proxyUrl
      env.https_proxy = proxyUrl
      env.HTTPS_PROXY = proxyUrl
      env.all_proxy = proxyUrl
      env.ALL_PROXY = proxyUrl
      env.NO_PROXY = 'localhost,127.0.0.1,.local'
      env.no_proxy = 'localhost,127.0.0.1,.local'
    }

    return spawn(getNativeHermesExecutable(), ['acp', '--accept-hooks'], {
      cwd: workspacePath,
      stdio: 'pipe',
      windowsHide: true,
      env,
    })
  }

  toBackendPath(hostPath: string): string {
    return hostPath
  }

  async ensureHermesInstalled(_proxyConfig: ProxyConfig | null): Promise<void> {
    // ACP is the runtime used by the desktop app. `hermes --version` can pass
    // even when the optional ACP dependencies are missing.
    const hermesExecutable = getNativeHermesExecutable()
    try {
      await execFileAsync(hermesExecutable, ['acp', '--check'])
      return
    } catch (error) {
      try {
        await execFileAsync(hermesExecutable, ['--version'])
      } catch {
        throw new Error(
          'Hermes Agent is not installed on this system. ' +
          'Run the setup script first:\n' +
          '  Windows: double-click setup-hermes-environment.cmd\n' +
          '  macOS: double-click setup-hermes-environment.command\n' +
          'Or install manually:\n' +
          '  pip install "hermes-agent[acp]"\n' +
          'Then restart Hermes Desktop Agent.',
        )
      }

      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        'Hermes Agent is installed, but ACP dependencies are missing. ' +
        'Run the setup script again to repair it:\n' +
        '  Windows: double-click setup-hermes-environment.cmd\n' +
        '  macOS: double-click setup-hermes-environment.command\n' +
        'Manual fallback:\n' +
        '  pip install "hermes-agent[acp]"\n' +
        detail,
      )
    }
  }

  async execCommand(args: string[]): Promise<string> {
    return spawnCommand(
      getNativeHermesExecutable(),
      args,
      createNativeHermesEnvironment(this.hermesHome),
    )
  }

  async gitAvailable(): Promise<boolean> {
    try {
      await execFileAsync('git', ['--version'])
      return true
    } catch {
      return false
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getProxyExportLines(cfg: ProxyConfig | null): string[] {
  if (!cfg || !cfg.enabled) return []

  const { host, port, type } = cfg
  if (!host || !port) return []

  const protocol = type === 'socks5' ? 'socks5' : 'http'
  const proxyUrl = `${protocol}://${host}:${port}`

  return [
    `export http_proxy="${proxyUrl}"`,
    `export HTTP_PROXY="${proxyUrl}"`,
    `export https_proxy="${proxyUrl}"`,
    `export HTTPS_PROXY="${proxyUrl}"`,
    `export all_proxy="${proxyUrl}"`,
    `export ALL_PROXY="${proxyUrl}"`,
    `export NO_PROXY="localhost,127.0.0.1,.local"`,
    `export no_proxy="localhost,127.0.0.1,.local"`,
  ]
}

function getNativeHermesHome() {
  if (process.env.HERMES_HOME) {
    return process.env.HERMES_HOME
  }

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? 'C:\\Users\\Default', 'AppData', 'Local'), 'hermes')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'hermes')
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'hermes')
}

function getNativeHermesExecutable() {
  if (process.env.HERMES_EXECUTABLE) {
    return process.env.HERMES_EXECUTABLE
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      ?? path.join(process.env.USERPROFILE ?? 'C:\\Users\\Default', 'AppData', 'Local')
    const candidates = [
      path.join(localAppData, 'hermes', 'venv', 'Scripts', 'hermes.exe'),
      path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
    ]
    const installed = candidates.find((candidate) => existsSync(candidate))
    if (installed) return installed
  }

  if (process.platform === 'darwin' && process.env.HERMES_RUNTIME_DIR) {
    const installed = path.join(process.env.HERMES_RUNTIME_DIR, 'hermes-venv', 'bin', 'hermes')
    if (existsSync(installed)) return installed
  }

  return 'hermes'
}

const PROVIDER_ENV_HINTS: Record<string, { apiKey: string; baseUrl?: string }> = {
  openrouter: { apiKey: 'OPENROUTER_API_KEY', baseUrl: 'OPENROUTER_BASE_URL' },
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL' },
  bailian: { apiKey: 'DASHSCOPE_API_KEY', baseUrl: 'DASHSCOPE_BASE_URL' },
  bailian_coding: { apiKey: 'DASHSCOPE_API_KEY', baseUrl: 'HERMES_QWEN_BASE_URL' },
  kimi: { apiKey: 'KIMI_API_KEY', baseUrl: 'KIMI_BASE_URL' },
  kimi_coding: { apiKey: 'KIMI_CODING_API_KEY' },
  zhipu_glm: { apiKey: 'GLM_API_KEY', baseUrl: 'GLM_BASE_URL' },
  zhipu_glm_en: { apiKey: 'ZAI_API_KEY', baseUrl: 'GLM_BASE_URL' },
  stepfun: { apiKey: 'STEPFUN_API_KEY', baseUrl: 'STEPFUN_BASE_URL' },
  modelscope: { apiKey: 'MODELSCOPE_API_KEY' },
  longcat: { apiKey: 'LONGCAT_API_KEY' },
  minimax: { apiKey: 'MINIMAX_API_KEY', baseUrl: 'MINIMAX_BASE_URL' },
  minimax_en: { apiKey: 'MINIMAX_API_KEY', baseUrl: 'MINIMAX_BASE_URL' },
  bailing: { apiKey: 'BAILING_API_KEY' },
  siliconflow: { apiKey: 'SILICONFLOW_API_KEY' },
  siliconflow_en: { apiKey: 'SILICONFLOW_API_KEY' },
  together: { apiKey: 'TOGETHER_API_KEY' },
  nous: { apiKey: 'NOUS_API_KEY' },
  ark_agentplan: { apiKey: 'ARK_API_KEY' },
  doubao_seed: { apiKey: 'ARK_API_KEY' },
  aihubmix: { apiKey: 'AIHUBMIX_API_KEY' },
  therouter: { apiKey: 'THEROUTER_API_KEY' },
  novita: { apiKey: 'NOVITA_API_KEY', baseUrl: 'NOVITA_BASE_URL' },
  nvidia: { apiKey: 'NVIDIA_API_KEY', baseUrl: 'NVIDIA_BASE_URL' },
  xiaomi_mimo: { apiKey: 'XIAOMI_API_KEY', baseUrl: 'XIAOMI_BASE_URL' },
  xai: { apiKey: 'XAI_API_KEY', baseUrl: 'XAI_BASE_URL' },
  google: { apiKey: 'GOOGLE_API_KEY' },
  groq: { apiKey: 'GROQ_API_KEY' },
}

function applyHermesConfigEnvironment(env: NodeJS.ProcessEnv, hermesHome: string) {
  const configPath = path.join(hermesHome, 'config.yaml')
  if (!existsSync(configPath)) return

  const content = readFileSync(configPath, 'utf8').replace(/\r\n/g, '\n')
  const provider = readModelScalar(content, 'provider')
  if (!provider) return

  const entry = findCustomProviderEntry(content, provider)
  const apiKey = readProviderScalar(entry ?? '', 'api_key')
  const baseUrl = readProviderScalar(entry ?? '', 'base_url')
  const envHint = PROVIDER_ENV_HINTS[provider]

  if (envHint) {
    if (apiKey && !env[envHint.apiKey]) env[envHint.apiKey] = apiKey
    if (baseUrl && envHint.baseUrl && !env[envHint.baseUrl]) env[envHint.baseUrl] = baseUrl
    return
  }

  if (apiKey && !env.OPENAI_API_KEY) env.OPENAI_API_KEY = apiKey
  if (baseUrl && !env.OPENAI_BASE_URL) env.OPENAI_BASE_URL = baseUrl
}

export function createNativeHermesEnvironment(
  hermesHome: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = createUtf8ProcessEnv({ ...baseEnv, HERMES_HOME: hermesHome })
  applyHermesConfigEnvironment(env, hermesHome)
  return env
}

function readModelScalar(content: string, key: string): string {
  const block = content.match(/(^|\n)model:\n([\s\S]*?)(\n\S|$)/)?.[2] ?? ''
  return parseYamlScalar(block.match(new RegExp(`^\\s{2}${key}:\\s*(.+)$`, 'm'))?.[1])
}

function findCustomProviderEntry(content: string, provider: string): string | null {
  const block = findRootBlock(content, 'custom_providers')
  if (!block) return null
  return splitCustomProviderEntries(block)
    .find((entry) => readProviderName(entry) === provider) ?? null
}

function findRootBlock(content: string, key: string): string | null {
  const marker = `${key}:\n`
  const start = content.indexOf(marker)
  if (start < 0) return null
  const afterMarker = start + marker.length
  const nextRoot = content.slice(afterMarker).search(/\n\S/)
  const end = nextRoot >= 0 ? afterMarker + nextRoot : content.length
  return content.slice(afterMarker, end)
}

function splitCustomProviderEntries(block: string): string[] {
  const lines = block.split('\n')
  const entries: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^\s{2}-\s/.test(line)) {
      if (current.length > 0) entries.push(current.join('\n').replace(/\n?$/, '\n'))
      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }

  if (current.length > 0) entries.push(current.join('\n').replace(/\n?$/, '\n'))
  return entries
}

function readProviderName(entry: string): string {
  const direct = entry.match(/^\s{2}-\s+name:\s*(.+)$/m)?.[1]
  return direct ? parseYamlScalar(direct) : readProviderScalar(entry, 'name')
}

function readProviderScalar(entry: string, key: string): string {
  return parseYamlScalar(entry.match(new RegExp(`^\\s{4}${key}:\\s*(.+)$`, 'm'))?.[1])
}

function parseYamlScalar(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Spawn a command and collect its stdout. Uses spawn() rather than execFile()
 * because execFile() cannot execute .cmd/.bat wrappers on Windows — pip's
 * `hermes` entry point is often a .cmd file that only spawn() can launch.
 */
function spawnCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = createUtf8ProcessEnv(),
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      env,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || `Command exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

function execFileAsync(command: string, args: string[]): Promise<string> {
  return spawnCommand(command, args)
}
