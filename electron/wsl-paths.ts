import { execFile } from 'node:child_process'
import path from 'node:path'
import { TextDecoder } from 'node:util'

let resolvedWslDistro: string | null = null
let resolvingWslDistro: Promise<string> | null = null
const DEFAULT_INSTALL_DISTRO = 'Ubuntu'

export const UTF8_PROCESS_ENV = {
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  HERMES_TEXT_ENCODING: 'utf-8',
} as const

type CommandOutputEncoding = BufferEncoding | 'gbk' | 'gb18030'
export type WslDistroInfo = {
  name: string
  state?: string
  version?: number
  default: boolean
  system: boolean
}

export function createUtf8ProcessEnv(base: NodeJS.ProcessEnv = process.env) {
  return {
    ...base,
    ...UTF8_PROCESS_ENV,
  }
}

export function decodeCommandOutput(output: Buffer | string, encoding: CommandOutputEncoding = 'utf8') {
  if (typeof output === 'string') {
    return output.replace(/^\uFEFF/, '').replace(/\0/g, '')
  }

  if (encoding === 'utf8' || encoding === 'utf-8') {
    return output.toString('utf8').replace(/^\uFEFF/, '').replace(/\0/g, '')
  }

  if (encoding === 'utf16le' || encoding === 'ucs2') {
    return output.toString(encoding).replace(/^\uFEFF/, '').replace(/\0/g, '')
  }

  try {
    return new TextDecoder(encoding).decode(output).replace(/^\uFEFF/, '').replace(/\0/g, '')
  } catch {
    return output.toString('utf8').replace(/^\uFEFF/, '').replace(/\0/g, '')
  }
}

function execFileAsync(command: string, args: string[], encoding: CommandOutputEncoding = 'utf8') {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, {
      encoding: 'buffer',
      env: createUtf8ProcessEnv(),
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const stdoutText = decodeCommandOutput(stdout, encoding).trim()
      const stderrText = decodeCommandOutput(stderr, encoding).trim()

      if (error) {
        reject(new Error(stderrText || error.message))
        return
      }

      resolve(stdoutText)
    })
  })
}

export function getCachedWslDistro() {
  return resolvedWslDistro ?? process.env.HERMES_WSL_DISTRO ?? null
}

export async function resolveWslDistro() {
  const configured = process.env.HERMES_WSL_DISTRO?.trim()
  if (configured) {
    if (isSystemWslDistro(configured)) {
      throw new Error(`${configured} is a Docker Desktop internal WSL distro and cannot run Hermes. Install Ubuntu with 'wsl --install -d Ubuntu' or set HERMES_WSL_DISTRO to a regular Linux distro.`)
    }

    resolvedWslDistro = configured
    return configured
  }

  if (resolvedWslDistro) {
    return resolvedWslDistro
  }

  if (!resolvingWslDistro) {
    resolvingWslDistro = detectDefaultWslDistro()
      .then((distro) => {
        resolvedWslDistro = distro
        process.env.HERMES_WSL_DISTRO = distro
        return distro
      })
      .finally(() => {
        resolvingWslDistro = null
      })
  }

  return resolvingWslDistro
}

async function detectDefaultWslDistro() {
  const distro = await detectUsableWslDistro()
  if (!distro) {
    await installDefaultWslDistro()
    const installedDistro = await detectUsableWslDistro()
    if (installedDistro) {
      return installedDistro
    }

    throw new Error("No usable WSL distro was found. Docker Desktop's internal distro cannot run Hermes. Finish Ubuntu installation or run 'wsl --install -d Ubuntu', then restart Hermes Desktop Agent.")
  }

  return distro
}

async function detectUsableWslDistro() {
  const output = await execFileAsync('wsl.exe', ['-l', '-v'], 'utf16le')
  return parseWslListVerbose(output)
}

async function installDefaultWslDistro() {
  const standardInstall = await tryWslInstall(['--install', '-d', DEFAULT_INSTALL_DISTRO])
  if (standardInstall.ok) {
    return
  }

  const webInstall = await tryWslInstall(['--install', '--web-download', '-d', DEFAULT_INSTALL_DISTRO])
  if (webInstall.ok) {
    return
  }

  throw new Error(`No usable WSL distro was found. Docker Desktop's internal distro cannot run Hermes. Tried to install ${DEFAULT_INSTALL_DISTRO}, but it did not complete. Run 'wsl --install --web-download -d ${DEFAULT_INSTALL_DISTRO}' from an elevated PowerShell, restart Windows if prompted, then launch Hermes Desktop Agent again. Store install error: ${standardInstall.error}. Web download error: ${webInstall.error}`)
}

async function tryWslInstall(args: string[]) {
  try {
    await execFileAsync('wsl.exe', args, 'utf16le')
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseWslListVerbose(output: string) {
  const distros = parseWslListVerboseEntries(output)
  const defaultDistro = distros.find((distro) => distro.default && !distro.system)
  const firstUsableDistro = distros.find((distro) => !distro.system)
  return defaultDistro?.name ?? firstUsableDistro?.name ?? null
}

export function parseWslListVerboseEntries(output: string): WslDistroInfo[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trimEnd())
    .filter((line) => line.trim())

  return lines.flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || /^NAME\s+STATE\s+VERSION$/i.test(trimmed)) {
      return []
    }

    const isDefault = trimmed.startsWith('*')
    const clean = trimmed.replace(/^\*\s*/, '')
    const match = clean.match(/^(?<name>.+?)\s+(?<state>Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+(?<version>\d+)\s*$/)
    const name = match?.groups?.name?.trim() ?? clean.split(/\s{2,}/)[0]?.trim()
    if (!name) {
      return []
    }

    return [{
      name,
      state: match?.groups?.state,
      version: match?.groups?.version ? Number(match.groups.version) : undefined,
      default: isDefault,
      system: isSystemWslDistro(name),
    }]
  })
}

export function isSystemWslDistro(name: string) {
  return /^docker-desktop(?:-data)?$/i.test(name.trim())
}

export function windowsPathToWslPath(windowsPath: string) {
  if (windowsPath.startsWith('/')) {
    return windowsPath.replace(/\\/g, '/')
  }

  if (windowsPath.startsWith('\\\\wsl')) {
    const wslPath = uncPathToWslPath(windowsPath)
    if (wslPath) {
      return wslPath
    }
  }

  const rawDriveMatch = windowsPath.match(/^([A-Za-z]):[\\/](.*)$/)
  if (rawDriveMatch) {
    return `/mnt/${rawDriveMatch[1].toLowerCase()}/${rawDriveMatch[2].replace(/\\/g, '/')}`
  }

  const normalized = path.resolve(windowsPath)
  const driveMatch = normalized.match(/^([A-Za-z]):\\(.*)$/)
  if (!driveMatch) {
    return normalized.replace(/\\/g, '/')
  }

  return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replace(/\\/g, '/')}`
}

export function wslPathToWindowsPath(wslPath: string) {
  const mountMatch = wslPath.match(/^\/mnt\/([A-Za-z])(?:\/(.*))?$/)
  if (!mountMatch) {
    return null
  }

  const rest = mountMatch[2]?.replace(/\//g, '\\') ?? ''
  return `${mountMatch[1].toUpperCase()}:\\${rest}`
}

export function uncPathToWslPath(uncPath: string) {
  const normalized = uncPath.replace(/\//g, '\\')
  const match = normalized.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)\\?(.*)$/i)
  if (!match) {
    return null
  }

  const rest = match[2]?.replace(/\\/g, '/') ?? ''
  return rest ? `/${rest}` : '/'
}

export function wslPathToUncPath(wslPath: string, distro = getCachedWslDistro()) {
  if (wslPath.startsWith('/mnt/')) {
    return null
  }

  if (!distro) {
    return null
  }

  return `\\\\wsl.localhost\\${distro}${wslPath.replace(/\//g, '\\')}`
}

export async function toWslPath(hostPath: string, distro?: string) {
  if (hostPath.startsWith('\\\\wsl')) {
    const wslPath = uncPathToWslPath(hostPath)
    if (wslPath) {
      return wslPath
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(hostPath)) {
    return windowsPathToWslPath(hostPath)
  }

  const resolvedDistro = distro ?? await resolveWslDistro()
  return execFileAsync('wsl.exe', ['-d', resolvedDistro, '--', 'wslpath', '-u', hostPath])
}

export async function toWindowsPath(wslPath: string, distro?: string) {
  const mounted = wslPathToWindowsPath(wslPath)
  if (mounted) {
    return mounted
  }

  const resolvedDistro = distro ?? await resolveWslDistro()
  return execFileAsync('wsl.exe', ['-d', resolvedDistro, '--', 'wslpath', '-w', wslPath])
}

export async function runWslCommand(args: string[], distro?: string) {
  const resolvedDistro = distro ?? await resolveWslDistro()
  return execFileAsync('wsl.exe', ['-d', resolvedDistro, '--', ...args])
}
