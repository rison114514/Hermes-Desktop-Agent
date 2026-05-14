import { contextBridge, ipcRenderer } from 'electron'
import type { HermesBridgeEvent } from './hermes-bridge.js'

const api = {
  sendMessage: (message: string) => ipcRenderer.invoke('hermes:send-message', message),
  cancelMessage: () => ipcRenderer.invoke('hermes:cancel-message'),
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
}

contextBridge.exposeInMainWorld('hermesDesktop', api)
