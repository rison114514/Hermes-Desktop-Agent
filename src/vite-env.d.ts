/// <reference types="vite/client" />

import type { HermesBridgeEvent } from '../electron/hermes-bridge'

declare global {
  interface Window {
    hermesDesktop: {
      sendMessage: (message: string) => Promise<{ ok: boolean }>
      onHermesEvent: (listener: (event: HermesBridgeEvent) => void) => () => void
      getHermesConfig: () => Promise<{ provider: string; model: string; source: string }>
      getHermesSkills: () => Promise<Array<{
        id: string
        name: string
        category: string
        description: string
        enabled: boolean
      }>>
      getWorkspaceSnapshot: () => Promise<{
        cwd: string
        session: string
        files: Array<{
          name: string
          path: string
          type: 'file' | 'directory'
          children?: Array<unknown>
        }>
        tasks: Array<{ id: string; title: string; done: boolean }>
        windows: {
          available: boolean
          wslPath: string
          windowsPath: string | null
          clipboardPreview: string
        }
      }>
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
