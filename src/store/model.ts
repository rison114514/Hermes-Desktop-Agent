import { create } from 'zustand'

// ============================================================================
// Provider & model metadata
// ============================================================================

export interface ModelMeta {
  id: string
  name: string
  description?: string
}

export interface ProviderMeta {
  id: string
  name: string
  description: string
  /** Brand color hex — used for the icon circle background */
  color: string
  /** Brand initials — shown inside the colored circle */
  initials: string
  models: ModelMeta[]
  requiresApiKey: boolean
  apiKeyEnvVar: string
}

export const KNOWN_PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus / Sonnet / Haiku 系列',
    color: '#D97706',
    initials: 'An',
    requiresApiKey: true,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: '最强推理能力' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: '性能与速度平衡' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: '最快响应' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5 / GPT-4o 系列',
    color: '#10A37F',
    initials: 'OA',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5', name: 'GPT-5', description: '最新旗舰模型' },
      { id: 'gpt-4o', name: 'GPT-4o', description: '多模态通用模型' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: '轻量快速模型' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek V3 / R1 系列',
    color: '#4F46E5',
    initials: 'DS',
    requiresApiKey: true,
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '最新旗舰' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: '推理增强' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '多模型聚合平台',
    color: '#6366F1',
    initials: 'OR',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    models: [
      { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8 (OpenRouter)' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (OpenRouter)' },
      { id: 'openai/gpt-5', name: 'GPT-5 (OpenRouter)' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (OpenRouter)' },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gemini 2.5 系列',
    color: '#4285F4',
    initials: 'Go',
    requiresApiKey: true,
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '旗舰推理模型' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '快速轻量模型' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    description: '超低延迟推理云',
    color: '#F97316',
    initials: 'GQ',
    requiresApiKey: true,
    apiKeyEnvVar: 'GROQ_API_KEY',
    models: [
      { id: 'llama-4-scout', name: 'Llama 4 Scout' },
      { id: 'llama-4-maverick', name: 'Llama 4 Maverick' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok 系列模型',
    color: '#E5E7EB',
    initials: 'XA',
    requiresApiKey: true,
    apiKeyEnvVar: 'XAI_API_KEY',
    models: [
      { id: 'grok-4', name: 'Grok 4', description: '最新旗舰' },
      { id: 'grok-3', name: 'Grok 3' },
    ],
  },
  {
    id: 'nous',
    name: 'Nous Research',
    description: 'Nous 开源模型系列',
    color: '#8B5CF6',
    initials: 'NR',
    requiresApiKey: false,
    apiKeyEnvVar: '',
    models: [],
  },
  {
    id: 'custom',
    name: '自定义',
    description: '其他兼容 OpenAI API 的提供方',
    color: '#64748B',
    initials: 'C',
    requiresApiKey: true,
    apiKeyEnvVar: 'CUSTOM_API_KEY',
    models: [],
  },
]

// ============================================================================
// Helpers
// ============================================================================

function getProvider(name: string): ProviderMeta | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === name)
}

// ============================================================================
// Store
// ============================================================================

export interface ModelStore {
  provider: string
  model: string
  source: string
  apiKeys: Record<string, string | null>
  loading: boolean
  saving: boolean

  setProvider: (provider: string) => void
  setModel: (model: string) => void
  loadConfig: () => Promise<void>
  setConfig: (config: { provider: string; model: string; source: string }) => void
  setApiKeys: (keys: Record<string, string | null>) => void
  saveConfig: (provider?: string, model?: string) => Promise<{ ok: boolean; error?: string }>
}

export const useModelStore = create<ModelStore>((set, get) => ({
  provider: 'custom',
  model: '读取中...',
  source: 'hermes config',
  apiKeys: {},
  loading: false,
  saving: false,

  setProvider: (provider) => {
    set({ provider })
    const meta = getProvider(provider)
    if (meta && meta.models.length > 0) {
      set({ model: meta.models[0].id })
    } else if (provider === 'custom') {
      set({ model: '' })
    }
  },

  setModel: (model) => set({ model }),

  loadConfig: async () => {
    if (!window.hermesDesktop) return
    set({ loading: true })
    try {
      const config = await window.hermesDesktop.getHermesConfig()
      set({ provider: config.provider, model: config.model, source: config.source })
    } catch {
      // Keep defaults
    }
    // Load API keys in parallel
    try {
      const keysResult = await window.hermesDesktop.getApiKeys()
      set({ apiKeys: keysResult.keys })
    } catch {
      // Keep empty
    }
    set({ loading: false })
  },

  setConfig: ({ provider, model, source }) => set({ provider, model, source }),

  setApiKeys: (keys) => set({ apiKeys: keys }),

  saveConfig: async (saveProvider?, saveModel?) => {
    if (!window.hermesDesktop) return { ok: false, error: 'IPC 不可用' }
    const p = saveProvider ?? get().provider
    const m = saveModel ?? get().model
    set({ saving: true })
    try {
      const result = await window.hermesDesktop.setModelConfig({ provider: p, model: m })
      if (!result.ok) {
        return { ok: false, error: result.error ?? '未知错误' }
      }
      if (result.config) {
        set({ provider: result.config.provider, model: result.config.model, source: result.config.source })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '保存失败' }
    } finally {
      set({ saving: false })
    }
  },
}))
