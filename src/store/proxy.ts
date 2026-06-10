import { create } from 'zustand'

export type ProxyType = 'http' | 'socks5'

export interface ProxyConfig {
  enabled: boolean
  type: ProxyType
  host: string
  port: number
}

interface ProxyStore extends ProxyConfig {
  setEnabled: (enabled: boolean) => void
  setType: (type: ProxyType) => void
  setHost: (host: string) => void
  setPort: (port: number) => void
}

const STORAGE_KEY = 'hermes-proxy'

function readStoredProxy(): ProxyConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        enabled: Boolean(parsed.enabled),
        type: parsed.type === 'socks5' ? 'socks5' : 'http',
        host: typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : '127.0.0.1',
        port: typeof parsed.port === 'number' && parsed.port > 0 && parsed.port < 65536 ? parsed.port : 7890,
      }
    }
  } catch {
    // localStorage unavailable or corrupt
  }
  return { enabled: false, type: 'http', host: '127.0.0.1', port: 7890 }
}

function syncProxyToMain(config: ProxyConfig) {
  try {
    window.hermesDesktop?.setProxyConfig?.(config)
  } catch {
    // IPC not available
  }
}

function toConfig(state: ProxyStore): ProxyConfig {
  return { enabled: state.enabled, type: state.type, host: state.host, port: state.port }
}

export const useProxyStore = create<ProxyStore>((set, get) => {
  const initial = readStoredProxy()

  return {
    ...initial,
    setEnabled: (enabled) => {
      const next: ProxyConfig = { ...toConfig(get()), enabled }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      syncProxyToMain(next)
      set({ enabled })
    },
    setType: (type) => {
      const next: ProxyConfig = { ...toConfig(get()), type }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      syncProxyToMain(next)
      set({ type })
    },
    setHost: (host) => {
      const next: ProxyConfig = { ...toConfig(get()), host }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      syncProxyToMain(next)
      set({ host })
    },
    setPort: (port) => {
      const next: ProxyConfig = { ...toConfig(get()), port }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      syncProxyToMain(next)
      set({ port })
    },
  }
})
