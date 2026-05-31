import { create } from 'zustand'

export interface ModManifest {
  name: string
  version: string
  description?: string
  author?: string
  icon?: string
  entry: string
  hermesVersion?: string
  permissions?: string[]
  config?: Record<string, { type: string; default?: unknown; label?: string }>
  skills?: Array<{ id: string; name: string; description: string; category?: string }>
  commands?: Array<{ id: string; name: string; description: string }>
}

export interface LoadedMod {
  name: string
  path: string
  manifest: ModManifest
  enabled: boolean
  error?: string
  exports?: ModExports
}

export interface ModExports {
  skills?: Array<{ id: string; name: string; description: string; enabled?: boolean; category?: string }>
  commands?: Array<{ id: string; name: string; description: string }>
  panels?: {
    sidebar?: React.ComponentType
    chatHeader?: React.ComponentType
    workspace?: React.ComponentType
  }
  hooks?: {
    systemPrompt?: (base: string) => string
    onUserMessage?: (text: string) => string
    onBeforeResponse?: (msg: unknown) => unknown
    onToolCall?: (tool: unknown) => unknown
    onBuildContext?: (context: unknown[]) => unknown[]
  }
  main?: {
    ipcHandlers?: Record<string, (...args: unknown[]) => unknown>
    onBackendStart?: () => void
    onBackendStop?: () => void
  }
  onEnable?: (ctx: ModContext) => void
  onDisable?: (ctx: ModContext) => void
  defaultConfig?: Record<string, unknown>
}

export interface ModContext {
  modName: string
  getConfig: (key: string) => unknown
  setConfig: (key: string, value: unknown) => void
  logger: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

interface ModsStore {
  mods: LoadedMod[]
  setMods: (mods: LoadedMod[]) => void
  addMod: (mod: LoadedMod) => void
  removeMod: (name: string) => void
  toggleMod: (name: string, enabled: boolean) => void
  setModError: (name: string, error: string | undefined) => void
  setModExports: (name: string, exports: ModExports | undefined) => void
  getModConfig: (modName: string, key: string) => unknown
  setModConfig: (modName: string, key: string, value: unknown) => void
}

function loadConfigs(): Record<string, Record<string, unknown>> {
  const STORAGE_KEY = 'hermes-mod-configs'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveConfigs(configs: Record<string, Record<string, unknown>>) {
  const STORAGE_KEY = 'hermes-mod-configs'
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
  } catch { /* noop */ }
}

export const useModsStore = create<ModsStore>((set, get) => ({
  mods: [],
  setMods: (mods) => set({ mods }),
  addMod: (mod) => set((s) => ({ mods: [...s.mods.filter((m) => m.name !== mod.name), mod] })),
  removeMod: (name) => set((s) => ({ mods: s.mods.filter((m) => m.name !== name) })),
  toggleMod: (name, enabled) =>
    set((s) => ({
      mods: s.mods.map((m) => (m.name === name ? { ...m, enabled } : m)),
    })),
  setModError: (name, error) =>
    set((s) => ({
      mods: s.mods.map((m) => (m.name === name ? { ...m, error } : m)),
    })),
  setModExports: (name, exports) =>
    set((s) => ({
      mods: s.mods.map((m) => (m.name === name ? { ...m, exports } : m)),
    })),
  getModConfig: (modName, key) => {
    const configs = loadConfigs()
    return configs[modName]?.[key]
  },
  setModConfig: (modName, key, value) => {
    const configs = loadConfigs()
    if (!configs[modName]) configs[modName] = {}
    if (value === undefined) {
      delete configs[modName][key]
    } else {
      configs[modName][key] = value
    }
    saveConfigs(configs)
  },
}))
