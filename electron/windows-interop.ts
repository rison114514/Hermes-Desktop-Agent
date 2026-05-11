import path from 'node:path'
import { clipboard, shell } from 'electron'
import {
  DEFAULT_WSL_DISTRO,
  runWslCommand,
  toWindowsPath,
  toWslPath,
  uncPathToWslPath,
  windowsPathToWslPath,
  wslPathToUncPath,
  wslPathToWindowsPath,
} from './wsl-paths.js'

export {
  DEFAULT_WSL_DISTRO,
  runWslCommand,
  toWindowsPath,
  toWslPath,
  uncPathToWslPath,
  windowsPathToWslPath,
  wslPathToUncPath,
  wslPathToWindowsPath,
}

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

async function resolveExplorerPath(hostPath: string) {
  if (hostPath.startsWith('\\\\wsl')) {
    return hostPath
  }

  if (/^[A-Za-z]:[\\/]/.test(hostPath)) {
    return path.resolve(hostPath)
  }

  return toWindowsPath(hostPath)
}
