import { contextBridge, ipcRenderer } from 'electron'
import type { HermesBridgeEvent } from './hermes-bridge.js'

const api = {
  sendMessage: (message: string) => ipcRenderer.invoke('hermes:send-message', message),
  cancelMessage: () => ipcRenderer.invoke('hermes:cancel-message'),
  respondHermesPermission: (requestId: string, optionId?: string | null) =>
    ipcRenderer.invoke('hermes:permission-response', requestId, optionId),
  onHermesEvent: (listener: (event: HermesBridgeEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: HermesBridgeEvent) => {
      listener(payload)
    }

    ipcRenderer.on('hermes:event', wrapped)

    return () => ipcRenderer.removeListener('hermes:event', wrapped)
  },
  listHermesSessions: () => ipcRenderer.invoke('hermes:list-sessions'),
  loadHermesSession: (sessionId: string, cwd: string) => ipcRenderer.invoke('hermes:load-session', sessionId, cwd),
  newHermesSession: () => ipcRenderer.invoke('hermes:new-session'),
  createHermesWorktree: (options?: { name?: string; directory?: string }) =>
    ipcRenderer.invoke('workspace:create-worktree', options),
  listHermesWorktrees: () => ipcRenderer.invoke('workspace:list-worktrees'),
  switchHermesWorktree: (worktreePath: string) => ipcRenderer.invoke('workspace:switch-worktree', worktreePath),
  selectWorktreeDirectory: () => ipcRenderer.invoke('workspace:select-worktree-directory'),
  selectWorkspaceDirectory: () => ipcRenderer.invoke('workspace:select-directory'),
  switchWorkspaceRoot: (workspacePath: string) => ipcRenderer.invoke('workspace:switch-root', workspacePath),
  getWorkspaceSnapshot: () => ipcRenderer.invoke('workspace:get-snapshot'),
  readWorkspaceDirectory: (directoryPath: string) => ipcRenderer.invoke('workspace:read-directory', directoryPath),
  revealWorkspaceItem: (itemPath: string) => ipcRenderer.invoke('workspace:reveal-item', itemPath),
  openWorkspaceItem: (itemPath: string) => ipcRenderer.invoke('workspace:open-item', itemPath),
  getWorkspaceItemPaths: (itemPath: string) => ipcRenderer.invoke('workspace:get-item-paths', itemPath),
  renameWorkspaceItem: (itemPath: string, nextName: string) => ipcRenderer.invoke('workspace:rename-item', itemPath, nextName),
  getHermesConfig: () => ipcRenderer.invoke('hermes:get-config'),
  getHermesSkills: () => ipcRenderer.invoke('hermes:get-skills'),
  getHermesCommands: () => ipcRenderer.invoke('hermes:get-commands'),
  readWorkspaceFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath),
  revealWorkspaceInWindows: () => ipcRenderer.invoke('windows:reveal-workspace'),
  openWorkspaceInWindows: () => ipcRenderer.invoke('windows:open-workspace'),
  readWindowsClipboard: () => ipcRenderer.invoke('windows:read-clipboard'),
  writeWindowsClipboard: (text: string) => ipcRenderer.invoke('windows:write-clipboard', text),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.invoke('window:set-always-on-top', alwaysOnTop),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  setProxyConfig: (config: { enabled: boolean; type: string; host: string; port: number }) =>
    ipcRenderer.invoke('proxy:set-config', config),
  detectProxyHost: () => ipcRenderer.invoke('proxy:detect-host'),
  restartBackend: () => ipcRenderer.invoke('hermes:restart-backend'),
  scanMods: () => ipcRenderer.invoke('mods:scan'),
  toggleMod: (modName: string, enabled: boolean) => ipcRenderer.invoke('mods:toggle', modName, enabled),
  uninstallMod: (modPath: string) => ipcRenderer.invoke('mods:uninstall', modPath),
  personaList: () => ipcRenderer.invoke('mods:persona-list'),
  personaSwitch: (personaId: string) => ipcRenderer.invoke('mods:persona-switch', personaId),
  callModIpc: (modName: string, method: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke(`mod:${modName}:${method}`, args),
}

contextBridge.exposeInMainWorld('hermesDesktop', api)
