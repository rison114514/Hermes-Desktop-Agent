import { contextBridge, ipcRenderer } from 'electron'
import type { HermesBridgeEvent } from './hermes-bridge.js'

const api = {
  sendMessage: (message: string) => ipcRenderer.invoke('hermes:send-message', message),
  onHermesEvent: (listener: (event: HermesBridgeEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: HermesBridgeEvent) => {
      listener(payload)
    }

    ipcRenderer.on('hermes:event', wrapped)

    return () => ipcRenderer.removeListener('hermes:event', wrapped)
  },
  getWorkspaceSnapshot: () => ipcRenderer.invoke('workspace:get-snapshot'),
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
