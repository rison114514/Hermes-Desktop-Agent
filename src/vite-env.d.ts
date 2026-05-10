/// <reference types="vite/client" />

import type { HermesBridgeEvent } from '../electron/hermes-bridge'

type DesktopWorkspaceFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: DesktopWorkspaceFileNode[]
}

type DesktopWorkspaceSnapshot = {
  cwd: string
  session: string
  files: DesktopWorkspaceFileNode[]
  tasks: Array<{ id: string; title: string; done: boolean }>
  windows: {
    available: boolean
    hostPlatform?: string
    distro?: string
    workspaceMode?: 'windows-workspace' | 'wsl-workspace'
    wslPath: string
    windowsPath: string | null
    uncPath?: string | null
    clipboardPreview: string
  }
}

type DesktopHermesWorktree = {
  path: string
  branch: string
  head: string
  detached: boolean
  current: boolean
  name: string
}

declare global {
  interface Window {
    hermesDesktop: {
      sendMessage: (message: string) => Promise<{ ok: boolean }>
      onHermesEvent: (listener: (event: HermesBridgeEvent) => void) => () => void
      listHermesSessions: () => Promise<Array<{
        sessionId: string
        cwd: string
        title?: string
        updatedAt?: string
      }>>
      loadHermesSession: (sessionId: string, cwd: string) => Promise<DesktopWorkspaceSnapshot>
      createHermesWorktree: (options?: { name?: string; directory?: string }) => Promise<{
        worktree: {
          path: string
          branch: string
          name: string
          root: string
        }
        snapshot: DesktopWorkspaceSnapshot
      }>
      listHermesWorktrees: () => Promise<DesktopHermesWorktree[]>
      switchHermesWorktree: (worktreePath: string) => Promise<DesktopWorkspaceSnapshot>
      selectWorktreeDirectory: () => Promise<{ canceled: boolean; path?: string }>
      selectWorkspaceDirectory: () => Promise<{ canceled: boolean; path?: string }>
      switchWorkspaceRoot: (workspacePath: string) => Promise<DesktopWorkspaceSnapshot>
      getHermesConfig: () => Promise<{ provider: string; model: string; source: string }>
      getHermesSkills: () => Promise<Array<{
        id: string
        name: string
        category: string
        description: string
        enabled: boolean
      }>>
      getWorkspaceSnapshot: () => Promise<DesktopWorkspaceSnapshot>
      readWorkspaceFile: (filePath: string) => Promise<{
        ok: boolean
        path?: string
        content?: string
        language?: string
        truncated?: boolean
        error?: string
      }>
      revealWorkspaceInWindows: () => Promise<{ ok: boolean; windowsPath?: string; error?: string }>
      openWorkspaceInWindows: () => Promise<{ ok: boolean; windowsPath?: string; error?: string }>
      readWindowsClipboard: () => Promise<{ ok: boolean; text?: string; error?: string }>
      writeWindowsClipboard: (text: string) => Promise<{ ok: boolean; error?: string }>
      getWindowState: () => Promise<{ visible: boolean; alwaysOnTop: boolean }>
      setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<{ visible: boolean; alwaysOnTop: boolean }>
      minimizeWindow: () => Promise<{ ok: boolean }>
      hideWindow: () => Promise<{ ok: boolean }>
      closeWindow: () => Promise<{ ok: boolean }>
    }
  }
}

export {}
