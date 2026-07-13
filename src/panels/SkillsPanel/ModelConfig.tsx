import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, RefreshCw, RotateCw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import {
  getProviderModels,
  HERMES_API_MODES,
  KNOWN_PROVIDERS,
  type HermesApiMode,
  type ModelMeta,
} from '@/store/model'
import { useModelStore } from '@/store/model'
import { useSessionStore } from '@/store/sessions'

export function ModelConfig() {
  const provider = useModelStore((state) => state.provider)
  const model = useModelStore((state) => state.model)
  const draftProvider = useModelStore((state) => state.draftProvider)
  const setDraftProvider = useModelStore((state) => state.setDraftProvider)
  const loadConfig = useModelStore((state) => state.loadConfig)
  const openTab = useSessionStore((state) => state.openTab)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const displayName = KNOWN_PROVIDERS.find((p) => p.id === provider)?.name ?? provider
  const selectedProvider = draftProvider ?? provider

  const openConfigTab = (providerId?: string) => {
    if (providerId) setDraftProvider(providerId)
    openTab({
      id: 'model-config',
      kind: 'normal',
      name: '模型配置',
      pageId: 'model-config',
      closable: true,
      detachable: true,
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] text-slate-500">
          {displayName} · {model}
        </p>
        <button
          type="button"
          onClick={() => openConfigTab()}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-slate-400 transition hover:border-cyan-300/40 hover:text-cyan-200"
          title="打开详细模型配置"
          aria-label="打开详细模型配置"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/80 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Provider</p>
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {KNOWN_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openConfigTab(p.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition ${
                selectedProvider === p.id
                  ? 'border border-cyan-300/30 bg-cyan-300/12'
                  : 'border border-transparent hover:bg-white/5'
              }`}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-xs font-medium ${selectedProvider === p.id ? 'text-cyan-100' : 'text-slate-200'}`}>
                  {p.name}
                </span>
                <span className="block text-[10px] leading-4 text-slate-500">{p.description}</span>
              </span>
              {selectedProvider === p.id ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ModelConfigPage() {
  const provider = useModelStore((state) => state.provider)
  const model = useModelStore((state) => state.model)
  const baseUrl = useModelStore((state) => state.baseUrl)
  const apiMode = useModelStore((state) => state.apiMode)
  const apiKeys = useModelStore((state) => state.apiKeys)
  const providerConfigs = useModelStore((state) => state.providerConfigs)
  const draftProvider = useModelStore((state) => state.draftProvider)
  const setDraftProvider = useModelStore((state) => state.setDraftProvider)
  const saving = useModelStore((state) => state.saving)
  const loadConfig = useModelStore((state) => state.loadConfig)
  const saveConfig = useModelStore((state) => state.saveConfig)

  const [editProvider, setEditProvider] = useState(provider)
  const [editModel, setEditModel] = useState(model)
  const [editBaseUrl, setEditBaseUrl] = useState(baseUrl)
  const [editApiMode, setEditApiMode] = useState<HermesApiMode>(apiMode)
  const [editApiKey, setEditApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<ModelMeta[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelFetchMsg, setModelFetchMsg] = useState('')
  const [validating, setValidating] = useState(false)
  const [validationMsg, setValidationMsg] = useState('')
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'error'>('idle')
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const getProviderDraft = (providerId: string) => {
    const saved = providerConfigs[providerId]
    const meta = KNOWN_PROVIDERS.find((p) => p.id === providerId)
    const isActiveProvider = providerId === provider

    return {
      provider: providerId,
      model: isActiveProvider ? model : (saved?.models?.[0]?.id ?? meta?.models[0]?.id ?? ''),
      baseUrl: saved?.baseUrl ?? (isActiveProvider ? baseUrl : meta?.baseUrl) ?? '',
      apiMode: saved?.apiMode ?? (isActiveProvider ? apiMode : undefined) ?? meta?.apiMode ?? 'chat_completions',
      models: saved?.models ?? [],
    }
  }

  useEffect(() => {
    const nextDraft = getProviderDraft(draftProvider ?? provider)
    setEditProvider(nextDraft.provider)
    setEditModel(nextDraft.model)
    setEditBaseUrl(nextDraft.baseUrl)
    setEditApiMode(nextDraft.apiMode)
    setFetchedModels(nextDraft.models)
    setEditApiKey('')
    setApiKeyDirty(false)
    setValidationMsg('')
    setValidationStatus('idle')
  }, [draftProvider, provider, model, baseUrl, apiMode, providerConfigs])

  const currentProviderMeta = useMemo(
    () => KNOWN_PROVIDERS.find((p) => p.id === editProvider),
    [editProvider],
  )
  const currentModels = useMemo(
    () => mergeModels(fetchedModels, getProviderModels(editProvider, editModel)),
    [editProvider, editModel, fetchedModels],
  )
  const displayName = KNOWN_PROVIDERS.find((p) => p.id === provider)?.name ?? provider
  const currentApiMode = HERMES_API_MODES.find((mode) => mode.value === editApiMode)
  const requiresApiKey = currentProviderMeta?.requiresApiKey ?? true
  const configJson = useMemo(() => {
    const models = Object.fromEntries(
      currentModels
        .filter((item) => item.id)
        .map((item) => [
          item.id,
          item.contextLength ? { context_length: item.contextLength } : {},
        ]),
    )

    return JSON.stringify({
      name: editProvider.trim(),
      base_url: editBaseUrl.trim(),
      api_key: apiKeyDirty && editApiKey.trim() ? '********' : '',
      api_mode: editApiMode,
      models,
    }, null, 2)
  }, [apiKeyDirty, currentModels, editApiKey, editApiMode, editBaseUrl, editProvider])

  const handleProviderChange = (newProvider: string) => {
    const nextDraft = getProviderDraft(newProvider)
    setDraftProvider(newProvider)
    setEditProvider(nextDraft.provider)
    setEditModel(nextDraft.model)
    setEditBaseUrl(nextDraft.baseUrl)
    setEditApiMode(nextDraft.apiMode)
    setEditApiKey('')
    setApiKeyDirty(false)
    setFetchedModels(nextDraft.models)
    setModelFetchMsg('')
    setValidationMsg('')
    setValidationStatus('idle')
    setStatus('idle')
    setErrorMsg('')
  }

  const markDirty = () => {
    setStatus('idle')
    setErrorMsg('')
    setValidationMsg('')
    setValidationStatus('idle')
  }

  const handleFetchModels = async () => {
    const nextBaseUrl = editBaseUrl.trim()
    if (!window.hermesDesktop || !nextBaseUrl) {
      setStatus('error')
      setErrorMsg('请先填写 Base URL')
      return
    }

    setFetchingModels(true)
    setModelFetchMsg('')
    setStatus('idle')
    setErrorMsg('')

    try {
      const result = await window.hermesDesktop.fetchProviderModels({
        provider: editProvider.trim(),
        baseUrl: nextBaseUrl,
        apiKey: apiKeyDirty ? editApiKey.trim() : undefined,
      })
      if (!result.ok || !result.models?.length) {
        setStatus('error')
        setErrorMsg(result.error ?? '没有获取到模型列表')
        return
      }

      setFetchedModels(result.models)
      setModelFetchMsg(`已获取 ${result.models.length} 个模型`)
      if (!editModel.trim()) {
        setEditModel(result.models[0].id)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleValidate = async () => {
    const nextProvider = editProvider.trim()
    const nextModel = editModel.trim()
    const nextBaseUrl = editBaseUrl.trim()
    if (!window.hermesDesktop) return

    setStatus('idle')
    setErrorMsg('')
    setValidationMsg('')
    setValidationStatus('idle')

    if (!nextProvider) {
      setValidationStatus('error')
      setValidationMsg('供应商名称不能为空')
      return
    }
    if (!nextModel) {
      setValidationStatus('error')
      setValidationMsg('模型 ID 不能为空')
      return
    }
    if (!nextBaseUrl) {
      setValidationStatus('error')
      setValidationMsg('Base URL 不能为空')
      return
    }

    setValidating(true)
    try {
      const result = await window.hermesDesktop.validateModelConfig({
        provider: nextProvider,
        model: nextModel,
        baseUrl: nextBaseUrl,
        apiMode: editApiMode,
        apiKey: apiKeyDirty ? editApiKey.trim() : undefined,
        models: currentModels,
      })

      if (result.models?.length) {
        setFetchedModels(result.models)
      }

      if (!result.ok) {
        setValidationStatus('error')
        setValidationMsg(result.error ?? '验证失败')
        return
      }

      setValidationStatus('valid')
      setValidationMsg('验证通过，接口可访问且模型可用')
    } catch (error) {
      setValidationStatus('error')
      setValidationMsg(error instanceof Error ? error.message : '验证失败')
    } finally {
      setValidating(false)
    }
  }

  const dirty =
    editProvider !== provider ||
    editModel !== model ||
    editBaseUrl !== baseUrl ||
    editApiMode !== apiMode ||
    apiKeyDirty

  const handleApply = async () => {
    if (!window.hermesDesktop || !dirty) return

    const nextProvider = editProvider.trim()
    const nextModel = editModel.trim()
    const nextBaseUrl = editBaseUrl.trim()

    setStatus('idle')
    setErrorMsg('')

    if (!nextProvider) {
      setStatus('error')
      setErrorMsg('供应商名称不能为空')
      return
    }
    if (!nextModel) {
      setStatus('error')
      setErrorMsg('模型 ID 不能为空')
      return
    }
    if (!nextBaseUrl) {
      setStatus('error')
      setErrorMsg('Base URL 不能为空')
      return
    }

    const result = await saveConfig({
      provider: nextProvider,
      model: nextModel,
      baseUrl: nextBaseUrl,
      apiMode: editApiMode,
      apiKey: apiKeyDirty ? editApiKey.trim() : undefined,
      models: currentModels,
    })
    if (!result.ok) {
      setStatus('error')
      setErrorMsg(result.error ?? '未知错误')
      return
    }

    setStatus('saved')
    setValidationMsg('')
    setValidationStatus('idle')
    setApiKeyDirty(false)
    setEditApiKey('')

    try {
      await window.hermesDesktop.restartBackend()
    } catch {
      // Backend may not be running yet.
    }

    loadConfig()
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">模型配置</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">供应商与模型</h1>
          <p className="mt-1 text-xs text-slate-500">{displayName} · {model}</p>
        </div>
        {status === 'saved' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-300">
            <Check className="h-3 w-3" />
            已应用
          </span>
        ) : status === 'error' ? (
          <span className="shrink-0 text-[11px] text-rose-300">失败</span>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-white/10 bg-slate-950/80 px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Provider</p>
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
            {KNOWN_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProviderChange(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition ${
                  editProvider === p.id
                    ? 'border border-cyan-300/30 bg-cyan-300/12'
                    : 'border border-transparent hover:bg-white/5'
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-medium ${editProvider === p.id ? 'text-cyan-100' : 'text-slate-200'}`}>
                    {p.name}
                  </span>
                  <span className="block text-[10px] leading-4 text-slate-500">{p.description}</span>
                </span>
                {editProvider === p.id ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
                ) : null}
              </button>
            ))}
          </div>
          {(editProvider === 'custom' || !currentProviderMeta) ? (
            <label className="mt-3 block">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Provider ID</span>
              <input
                type="text"
                value={editProvider}
                onChange={(e) => { setEditProvider(e.target.value); markDirty() }}
                disabled={saving}
                placeholder="my_provider"
                className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
              />
            </label>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-slate-950/80 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Endpoint</p>
          <input
            type="url"
            value={editBaseUrl}
            onChange={(e) => { setEditBaseUrl(e.target.value); markDirty() }}
            disabled={saving}
            placeholder="https://api.example.com/v1"
            className="mt-2 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
          />

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">API Mode</span>
              <select
                value={editApiMode}
                onChange={(e) => { setEditApiMode(e.target.value as HermesApiMode); markDirty() }}
                disabled={saving}
                className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                {HERMES_API_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Model ID</span>
              <div className="mt-1 flex gap-1.5">
                <input
                  list="hermes-model-options"
                  type="text"
                  value={editModel}
                  onChange={(e) => { setEditModel(e.target.value); markDirty() }}
                  disabled={saving}
                  placeholder="输入模型 ID"
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => void handleFetchModels()}
                  disabled={saving || fetchingModels || !editBaseUrl.trim()}
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md border border-white/10 bg-slate-900 text-slate-400 transition enabled:hover:border-cyan-300/40 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-slate-600"
                  title="从接口获取模型列表"
                  aria-label="从接口获取模型列表"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <datalist id="hermes-model-options">
                {currentModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </label>
          </div>

          {currentApiMode ? (
            <p className="mt-2 text-[10px] leading-4 text-slate-500">{currentApiMode.description}</p>
          ) : null}
          {modelFetchMsg ? (
            <p className="mt-1 text-[10px] leading-4 text-emerald-300">{modelFetchMsg}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-slate-950/80 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Models</p>
              <p className="mt-1 text-[10px] text-slate-500">第一个模型会作为此供应商的默认模型写入 model.default</p>
            </div>
            <button
              type="button"
              onClick={() => void handleFetchModels()}
              disabled={saving || fetchingModels || !editBaseUrl.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 transition enabled:hover:border-cyan-300/40 enabled:hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
              获取模型列表
            </button>
          </div>

          {currentModels.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {currentModels.slice(0, 12).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setEditModel(item.id); markDirty() }}
                  className={`min-w-0 rounded-md border px-3 py-2 text-left transition ${
                    editModel === item.id
                      ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-50'
                      : 'border-white/10 bg-slate-900/70 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <span className="block truncate text-xs font-medium">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.id}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">暂无模型配置。可以手动输入模型 ID，或从接口获取模型列表。</p>
          )}
        </div>

        {requiresApiKey ? (
          <div className="rounded-lg border border-white/10 bg-slate-950/80 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">API Key</p>
              {apiKeys[editProvider] ? (
                <span className="truncate text-[10px] text-slate-500">已设置 {apiKeys[editProvider]}</span>
              ) : null}
            </div>
            <div className="relative mt-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={editApiKey}
                onChange={(e) => { setEditApiKey(e.target.value); setApiKeyDirty(true); markDirty() }}
                disabled={saving}
                placeholder={currentProviderMeta?.apiKeyLabel ?? currentProviderMeta?.apiKeyEnvVar ?? 'API Key'}
                className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
                tabIndex={-1}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
              留空会保留已保存的 Key；首次配置时也可以使用环境变量 {currentProviderMeta?.apiKeyEnvVar ?? 'API_KEY'}
            </p>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="text-[11px] leading-relaxed text-rose-300">{errorMsg}</p>
        ) : null}
        {validationMsg ? (
          <p className={`text-[11px] leading-relaxed ${validationStatus === 'valid' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {validationMsg}
          </p>
        ) : null}

        <div className="rounded-lg border border-white/10 bg-slate-950/80 px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Config JSON</p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-[11px] leading-5 text-slate-300">
            {configJson}
          </pre>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleValidate()}
            disabled={saving || validating || !editBaseUrl.trim() || !editModel.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          >
            <ShieldCheck className={`h-3.5 w-3.5 ${validating ? 'animate-pulse' : ''}`} />
            {validating ? '验证中...' : '验证当前配置'}
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!dirty || saving || validating}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition enabled:hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          >
            <RotateCw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
            {saving ? '应用中...' : '应用并重启后端'}
          </button>
        </div>
      </div>
    </div>
  )
}

function mergeModels(base: ModelMeta[], extra: ModelMeta[]): ModelMeta[] {
  const byId = new Map<string, ModelMeta>()
  for (const model of [...base, ...extra]) {
    if (!model.id || byId.has(model.id)) continue
    byId.set(model.id, model)
  }
  return [...byId.values()]
}
