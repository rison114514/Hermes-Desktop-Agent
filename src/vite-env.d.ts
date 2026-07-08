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
  sessionTitle?: string | null
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

type DesktopHermesApiMode = 'chat_completions' | 'anthropic_messages' | 'codex_responses' | 'bedrock_converse'

type DesktopHermesConfig = {
  provider: string
  model: string
  baseUrl?: string
  apiMode?: DesktopHermesApiMode
  source: string
  providers?: Record<string, DesktopHermesProviderConfig>
}

type DesktopHermesProviderConfig = {
  provider: string
  baseUrl?: string
  apiMode?: DesktopHermesApiMode
  models?: Array<{ id: string; name: string; contextLength?: number }>
  hasApiKey?: boolean
}

type DesktopHermesModelConfigRequest = {
  provider?: string
  model?: string
  baseUrl?: string
  apiMode?: DesktopHermesApiMode
  apiKey?: string
  models?: Array<{ id: string; contextLength?: number }>
}

type DesktopHermesFetchModelsRequest = {
  provider?: string
  baseUrl: string
  apiKey?: string
}

declare global {
  interface Window {
    hermesDesktop: {
      sendMessage: (message: string, sessionId?: string) => Promise<{ ok: boolean }>
      cancelMessage: () => Promise<{ ok: boolean; cancelled: boolean }>
      respondHermesPermission: (requestId: string, optionId?: string | null) => Promise<{ ok: boolean; error?: string }>
      onHermesEvent: (listener: (event: HermesBridgeEvent) => void) => () => void
      listHermesSessions: () => Promise<Array<{
        sessionId: string
        cwd: string
        title?: string
        updatedAt?: string
      }>>
      loadHermesSession: (sessionId: string, cwd: string) => Promise<DesktopWorkspaceSnapshot>
      newHermesSession: () => Promise<DesktopWorkspaceSnapshot>
      deleteHermesSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
      renameHermesSession: (sessionId: string, newTitle: string) => Promise<{ ok: boolean; error?: string }>
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
      softSwitchWorkspace: (workspacePath: string) => Promise<DesktopWorkspaceSnapshot>
      getHermesConfig: () => Promise<DesktopHermesConfig>
      setModelConfig: (config: DesktopHermesModelConfigRequest) => Promise<{
        ok: boolean
        error?: string
        config?: DesktopHermesConfig
      }>
      fetchProviderModels: (config: DesktopHermesFetchModelsRequest) => Promise<{
        ok: boolean
        error?: string
        models?: Array<{ id: string; name: string; contextLength?: number }>
      }>
      validateModelConfig: (config: DesktopHermesModelConfigRequest) => Promise<{
        ok: boolean
        error?: string
        models?: Array<{ id: string; name: string; contextLength?: number }>
      }>
      getApiKeys: () => Promise<{ keys: Record<string, string | null> }>
      setApiKey: (config: { provider: string; apiKey: string }) => Promise<{ ok: boolean; error?: string }>
      getHermesSkills: () => Promise<Array<{
        id: string
        name: string
        category: string
        description: string
        enabled: boolean
      }>>
      getHermesCommands: () => Promise<Array<{
        id: string
        name: string
        description: string
      }>>
      getWorkspaceSnapshot: () => Promise<DesktopWorkspaceSnapshot>
      readWorkspaceDirectory: (directoryPath: string) => Promise<{
        ok: boolean
        path?: string
        files?: DesktopWorkspaceFileNode[]
        error?: string
      }>
      revealWorkspaceItem: (itemPath: string) => Promise<{ ok: boolean; windowsPath?: string; error?: string }>
      openWorkspaceItem: (itemPath: string) => Promise<{ ok: boolean; windowsPath?: string; error?: string }>
      getWorkspaceItemPaths: (itemPath: string) => Promise<{
        ok: boolean
        path?: string
        relativePath?: string
        error?: string
      }>
      renameWorkspaceItem: (itemPath: string, nextName: string) => Promise<{
        ok: boolean
        path?: string
        snapshot?: DesktopWorkspaceSnapshot
        error?: string
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
      openTodoWidget: () => Promise<{ ok: boolean }>
      closeTodoWidget: () => Promise<{ ok: boolean }>
      setTodoWidgetPin: (pinned: boolean) => Promise<{ ok: boolean; pinned: boolean }>
      setProxyConfig: (config: { enabled: boolean; type: string; host: string; port: number }) => Promise<{ ok: boolean }>
      detectProxyHost: () => Promise<{ host: string }>
      restartBackend: () => Promise<{ ok: boolean }>
      hotReload: () => Promise<{ mods: Array<{ name: string; path: string; manifest: Record<string, unknown>; enabled: boolean; error?: string }>; todoApplied: number; rebuilt: boolean }>
      scanMods: () => Promise<Array<{
        name: string
        path: string
        manifest: Record<string, unknown>
        enabled: boolean
        error?: string
      }>>
      toggleMod: (modName: string, enabled: boolean) => Promise<{ ok: boolean }>
      uninstallMod: (modPath: string) => Promise<{ ok: boolean }>
      personaList: () => Promise<Array<{ id: string; name: string; icon: string; description: string; active: boolean }>>
      personaSwitch: (personaId: string) => Promise<{ ok: boolean; activeId?: string | null }>
      callModIpc: (modName: string, method: string, args?: Record<string, unknown>) => Promise<unknown>
      createSession: (name: string, cwd?: string) => Promise<{ id: string; name: string; cwd: string } | null>
      closeSession: (sessionId: string) => Promise<{ ok: boolean }>
      switchSession: (sessionId: string) => Promise<{
        ok: boolean
        sessions?: Array<{ id: string; name: string; cwd: string }>
        snapshot?: DesktopWorkspaceSnapshot
        commands?: Array<{ id: string; name: string; description: string }>
      }>
      listSessions: () => Promise<Array<{ id: string; name: string; cwd: string }>>
    }
  }
}

export {}
