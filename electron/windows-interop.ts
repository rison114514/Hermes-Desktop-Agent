import { execFile } from 'node:child_process'
import path from 'node:path'
import { clipboard, shell } from 'electron'

export interface WindowsInteropSnapshot {
  available: boolean
  hostPlatform: NodeJS.Platform
  distro: string
  workspaceMode: 'windows-workspace' | 'wsl-workspace'
  wslPath: string
  windowsPath: string | null
  uncPath: string | null
}

export interface WindowsInteropResult {
  ok: boolean
  error?: string
}

const DEFAULT_WSL_DISTRO = process.env.HERMES_WSL_DISTRO || 'Ubuntu'

function execFileAsync(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }

      resolve(stdout.trim())
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

export async function revealInExplorer(hostPath: string) {
  const windowsPath = await resolveExplorerPath(hostPath)
  shell.showItemInFolder(windowsPath)
  return windowsPath
}

export async function openPathWithDefaultApp(hostPath: string) {
  const windowsPath = await resolveExplorerPath(hostPath)
  const error = await shell.openPath(windowsPath)
  if (error) {
    throw new Error(error)
  }

  return windowsPath
}

export async function readWindowsClipboard() {
  return clipboard.readText()
}

export async function writeWindowsClipboard(text: string) {
  clipboard.writeText(text)
}

export async function getWindowsInteropSnapshot(hostPath: string): Promise<WindowsInteropSnapshot> {
  const workspaceMode = hostPath.startsWith('\\\\wsl') ? 'wsl-workspace' : 'windows-workspace'
  const wslPath = await toWslPath(hostPath)
  const windowsPath = workspaceMode === 'windows-workspace'
    ? path.resolve(hostPath)
    : await toWindowsPath(wslPath).catch(() => null)
  const uncPath = workspaceMode === 'wsl-workspace' ? path.resolve(hostPath) : wslPathToUncPath(wslPath)

  return {
    available: true,
    hostPlatform: process.platform,
    distro: DEFAULT_WSL_DISTRO,
    workspaceMode,
    wslPath,
    windowsPath,
    uncPath,
  }
}

export async function runWslCommand(args: string[], distro = DEFAULT_WSL_DISTRO) {
  return execFileAsync('wsl.exe', ['-d', distro, '--', ...args])
}

async function resolveExplorerPath(hostPath: string) {
  if (hostPath.startsWith('\\\\wsl')) {
    return hostPath
  }

  if (/^[A-Za-z]:[\\/]/.test(hostPath)) {
    return path.resolve(hostPath)
  }

  return toWindowsPath(hostPath)
}
