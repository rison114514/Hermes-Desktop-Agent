import { create } from 'zustand'
import { CCSWITCH_PROVIDER_PRESETS } from './provider-presets'

// ============================================================================
// Provider & model metadata
// ============================================================================

export type HermesApiMode = 'chat_completions' | 'anthropic_messages' | 'codex_responses' | 'bedrock_converse'

export interface ModelMeta {
  id: string
  name: string
  description?: string
  contextLength?: number
}

export interface ProviderMeta {
  id: string
  name: string
  description: string
  /** Brand color hex, used for the provider mark */
  color: string
  /** Brand initials shown inside the provider mark */
  initials: string
  baseUrl: string
  apiMode: HermesApiMode
  models: ModelMeta[]
  requiresApiKey: boolean
  apiKeyEnvVar: string
  apiKeyLabel?: string
  websiteUrl?: string
  apiKeyUrl?: string
}

export interface ModelConfigDraft {
  provider: string
  model: string
  baseUrl?: string
  apiMode?: HermesApiMode
  apiKey?: string
  models?: ModelMeta[]
}

export interface SavedProviderConfig {
  provider: string
  baseUrl?: string
  apiMode?: HermesApiMode
  models?: ModelMeta[]
  hasApiKey?: boolean
}

export const HERMES_API_MODES: Array<{ value: HermesApiMode; label: string; description: string }> = [
  { value: 'chat_completions', label: 'OpenAI Chat Completions', description: 'OpenAI 兼容接口' },
  { value: 'anthropic_messages', label: 'Anthropic Messages', description: 'Claude 兼容接口' },
  { value: 'codex_responses', label: 'Codex Responses', description: 'OpenAI Responses / Codex' },
  { value: 'bedrock_converse', label: 'Bedrock Converse', description: 'AWS Bedrock' },
]

export const KNOWN_PROVIDERS: ProviderMeta[] = [
  ...CCSWITCH_PROVIDER_PRESETS,
  {
    id: 'custom',
    name: '自定义',
    description: '其他兼容 OpenAI / Anthropic 的提供方',
    color: '#64748B',
    initials: 'C',
    baseUrl: '',
    apiMode: 'chat_completions',
    requiresApiKey: true,
    apiKeyEnvVar: 'CUSTOM_API_KEY',
    models: [],
  },
]


// ============================================================================
// Helpers
// ============================================================================

export function getProvider(id: string): ProviderMeta | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id)
}

export function getDefaultModel(providerId: string): string {
  return getProvider(providerId)?.models[0]?.id ?? ''
}

export function getProviderModels(providerId: string, selectedModel?: string): ModelMeta[] {
  const provider = getProvider(providerId)
  const models = provider?.models ?? []
  if (!selectedModel || models.some((model) => model.id === selectedModel)) {
    return models
  }
  return [{ id: selectedModel, name: selectedModel }, ...models]
}

// ============================================================================
// Store
// ============================================================================

export interface ModelStore {
  provider: string
  model: string
  baseUrl: string
  apiMode: HermesApiMode
  source: string
  apiKeys: Record<string, string | null>
  providerConfigs: Record<string, SavedProviderConfig>
  draftProvider: string | null
  loading: boolean
  saving: boolean

  setProvider: (provider: string) => void
  setModel: (model: string) => void
  setDraftProvider: (provider: string | null) => void
  setConfig: (config: {
    provider: string
    model: string
    baseUrl?: string
    apiMode?: HermesApiMode
    source: string
    providers?: Record<string, SavedProviderConfig>
  }) => void
  setApiKeys: (keys: Record<string, string | null>) => void
  loadConfig: () => Promise<void>
  saveConfig: (config?: ModelConfigDraft) => Promise<{ ok: boolean; error?: string }>
}

export const useModelStore = create<ModelStore>((set, get) => ({
  provider: 'custom',
  model: '读取中...',
  baseUrl: '',
  apiMode: 'chat_completions',
  source: 'hermes config',
  apiKeys: {},
  providerConfigs: {},
  draftProvider: null,
  loading: false,
  saving: false,

  setProvider: (provider) => {
    const meta = getProvider(provider)
    set({
      provider,
      model: meta?.models[0]?.id ?? '',
      baseUrl: meta?.baseUrl ?? '',
      apiMode: meta?.apiMode ?? 'chat_completions',
    })
  },

  setModel: (model) => set({ model }),

  setDraftProvider: (provider) => set({ draftProvider: provider }),

  setConfig: ({ provider, model, baseUrl, apiMode, source, providers }) => {
    const meta = getProvider(provider)
    set({
      provider,
      model,
      baseUrl: baseUrl ?? meta?.baseUrl ?? '',
      apiMode: apiMode ?? meta?.apiMode ?? 'chat_completions',
      source,
      providerConfigs: providers ?? get().providerConfigs,
    })
  },

  setApiKeys: (keys) => set({ apiKeys: keys }),

  loadConfig: async () => {
    if (!window.hermesDesktop) return
    set({ loading: true })
    try {
      const config = await window.hermesDesktop.getHermesConfig()
      get().setConfig(config)
    } catch {
      // Keep defaults
    }
    try {
      const keysResult = await window.hermesDesktop.getApiKeys()
      set({ apiKeys: keysResult.keys })
    } catch {
      // Keep empty
    }
    set({ loading: false })
  },

  saveConfig: async (config) => {
    if (!window.hermesDesktop) return { ok: false, error: 'IPC 不可用' }
    const current = get()
    const provider = config?.provider ?? current.provider
    const model = config?.model ?? current.model
    const meta = getProvider(provider)
    const payload: ModelConfigDraft = {
      provider,
      model,
      baseUrl: config?.baseUrl ?? current.baseUrl ?? meta?.baseUrl,
      apiMode: config?.apiMode ?? current.apiMode ?? meta?.apiMode,
      apiKey: config?.apiKey,
      models: config?.models ?? getProviderModels(provider, model),
    }

    set({ saving: true })
    try {
      const result = await window.hermesDesktop.setModelConfig(payload)
      if (!result.ok) {
        return { ok: false, error: result.error ?? '未知错误' }
      }
      if (result.config) {
        get().setConfig(result.config)
        set({ draftProvider: null })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '保存失败' }
    } finally {
      set({ saving: false })
    }
  },
}))
