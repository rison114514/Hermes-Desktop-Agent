import { execFile } from 'node:child_process'
import path from 'node:path'
import { TextDecoder } from 'node:util'

let resolvedWslDistro: string | null = null
let resolvingWslDistro: Promise<string> | null = null

export const UTF8_PROCESS_ENV = {
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  HERMES_TEXT_ENCODING: 'utf-8',
} as const

type CommandOutputEncoding = BufferEncoding | 'gbk' | 'gb18030'

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
  const output = await execFileAsync('wsl.exe', ['-l', '-v'], 'utf16le')
  const distro = parseWslListVerbose(output)
  if (!distro) {
    throw new Error("No WSL distro was found. Install one with 'wsl --install -d Ubuntu' or set HERMES_WSL_DISTRO.")
  }

  return distro
}

export function parseWslListVerbose(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trimEnd())
    .filter((line) => line.trim())

  const defaultLine = lines.find((line) => line.trimStart().startsWith('*'))
  const candidateLine = defaultLine ?? lines.find((line) => {
    const trimmed = line.trim()
    return trimmed && !/^NAME\s+STATE\s+VERSION$/i.test(trimmed)
  })

  if (!candidateLine) {
    return null
  }

  const clean = candidateLine.trim().replace(/^\*\s*/, '')
  const match = clean.match(/^(?<name>.+?)\s+(Running|Stopped|Installing|Uninstalling|Converting|Exporting|Importing)\s+\d+\s*$/)
  if (match?.groups?.name) {
    return match.groups.name.trim()
  }

  const [first] = clean.split(/\s{2,}/)
  return first?.trim() || null
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
