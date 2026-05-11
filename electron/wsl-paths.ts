import { execFile } from 'node:child_process'
import path from 'node:path'
import { TextDecoder } from 'node:util'

export const DEFAULT_WSL_DISTRO = process.env.HERMES_WSL_DISTRO || 'Ubuntu-22.04'

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

export function wslPathToUncPath(wslPath: string, distro = DEFAULT_WSL_DISTRO) {
  if (wslPath.startsWith('/mnt/')) {
    return null
  }

  return `\\\\wsl.localhost\\${distro}${wslPath.replace(/\//g, '\\')}`
}

export async function toWslPath(hostPath: string, distro = DEFAULT_WSL_DISTRO) {
  if (hostPath.startsWith('\\\\wsl')) {
    const wslPath = uncPathToWslPath(hostPath)
    if (wslPath) {
      return wslPath
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(hostPath)) {
    return windowsPathToWslPath(hostPath)
  }

  return execFileAsync('wsl.exe', ['-d', distro, '--', 'wslpath', '-u', hostPath])
}

export async function toWindowsPath(wslPath: string, distro = DEFAULT_WSL_DISTRO) {
  const mounted = wslPathToWindowsPath(wslPath)
  if (mounted) {
    return mounted
  }

  return execFileAsync('wsl.exe', ['-d', distro, '--', 'wslpath', '-w', wslPath])
}

export async function runWslCommand(args: string[], distro = DEFAULT_WSL_DISTRO) {
  return execFileAsync('wsl.exe', ['-d', distro, '--', ...args])
}
