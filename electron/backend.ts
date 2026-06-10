import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
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
  if (raw === 'wsl') {
    _backendType = 'wsl'
  } else if (raw === 'native') {
    _backendType = 'native'
  } else {
    console.warn(`[backend] unknown HERMES_BACKEND="${raw}", falling back to native`)
    _backendType = 'native'
  }
  return _backendType
}

export function getBackendProvider(): BackendProvider {
  if (_backendProvider) return _backendProvider

  const type = getBackendType()
  _backendProvider = type === 'wsl' ? new WslBackendProvider() : new NativeWindowsBackendProvider()
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

class NativeWindowsBackendProvider implements BackendProvider {
  readonly type: BackendType = 'native'
  readonly hermesHome: string

  constructor() {
    this.hermesHome = path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? 'C:\\Users\\Default', 'AppData', 'Local'), 'hermes')
  }

  async spawnAcp(
    workspacePath: string,
    proxyConfig: ProxyConfig | null,
  ): Promise<ChildProcessWithoutNullStreams> {
    const env: NodeJS.ProcessEnv = createUtf8ProcessEnv({ ...process.env })

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

    return spawn('hermes', ['acp', '--accept-hooks'], {
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
    // Check if hermes is callable
    try {
      await execFileAsync('hermes', ['--version'])
      return
    } catch {
      // Not found — point user to setup-native script
    }

    throw new Error(
      'Hermes Agent is not installed on this Windows system. ' +
      'Run the setup script first:\n' +
      '  Double-click setup-native.cmd in the Hermes Desktop Agent folder\n' +
      'Or install manually:\n' +
      '  pip install hermes-agent\n' +
      'Then restart Hermes Desktop Agent.',
    )
  }

  async execCommand(args: string[]): Promise<string> {
    return execFileAsync('hermes', args)
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

/**
 * Spawn a command and collect its stdout. Uses spawn() rather than execFile()
 * because execFile() cannot execute .cmd/.bat wrappers on Windows — pip's
 * `hermes` entry point is often a .cmd file that only spawn() can launch.
 */
function spawnCommand(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      env: createUtf8ProcessEnv(),
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
