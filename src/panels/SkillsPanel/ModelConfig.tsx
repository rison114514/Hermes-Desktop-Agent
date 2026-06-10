import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, RotateCw } from 'lucide-react'
import { useModelStore, KNOWN_PROVIDERS } from '@/store/model'

export function ModelConfig() {
  const provider = useModelStore((state) => state.provider)
  const model = useModelStore((state) => state.model)
  const apiKeys = useModelStore((state) => state.apiKeys)
  const saving = useModelStore((state) => state.saving)
  const loadConfig = useModelStore((state) => state.loadConfig)
  const saveConfig = useModelStore((state) => state.saveConfig)

  const [editProvider, setEditProvider] = useState(provider)
  const [editModel, setEditModel] = useState(model)
  const [editApiKey, setEditApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Sync local state from store on mount
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    setEditProvider(provider)
    setEditModel(model)
  }, [provider, model])

  const handleProviderChange = (newProvider: string) => {
    setEditProvider(newProvider)
    setStatus('idle')
    setErrorMsg('')
    setEditApiKey('')
    setApiKeyDirty(false)
    const meta = KNOWN_PROVIDERS.find((p) => p.id === newProvider)
    if (meta && meta.models.length > 0) {
      setEditModel(meta.models[0].id)
    } else if (newProvider === 'custom') {
      setEditModel('')
    }
  }

  const dirtyProvider = editProvider !== provider
  const dirtyModel = editModel !== model
  const dirty = dirtyProvider || dirtyModel || apiKeyDirty

  const handleApply = async () => {
    if (!window.hermesDesktop || !dirty) return

    setStatus('idle')
    setErrorMsg('')

    // 1. Save API key first (if dirty)
    if (apiKeyDirty && editApiKey) {
      const keyResult = await window.hermesDesktop.setApiKey({ provider: editProvider, apiKey: editApiKey })
      if (!keyResult.ok) {
        setStatus('error')
        setErrorMsg(keyResult.error ?? '保存 API Key 失败')
        return
      }
    }

    // 2. Save provider + model
    const result = await saveConfig(editProvider, editModel)
    if (!result.ok) {
      setStatus('error')
      setErrorMsg(result.error ?? '未知错误')
      return
    }

    setStatus('saved')
    setApiKeyDirty(false)
    setEditApiKey('')

    // 3. Restart backend to apply new model config
    try {
      await window.hermesDesktop.restartBackend()
    } catch {
      // restart may fail if backend isn't running yet — that's ok
    }

    // 4. Reload after restart
    loadConfig()
  }

  const currentProviderMeta = KNOWN_PROVIDERS.find((p) => p.id === editProvider)
  const displayName = KNOWN_PROVIDERS.find((p) => p.id === provider)?.name ?? provider

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] text-slate-500">
          {displayName} · {model}
        </p>
        {status === 'saved' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-300">
            <Check className="h-3 w-3" />
            已应用
          </span>
        ) : status === 'error' ? (
          <span className="shrink-0 text-[11px] text-rose-300">失败</span>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        {/* Provider selector */}
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Provider</p>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {KNOWN_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProviderChange(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${
                  editProvider === p.id
                    ? 'border border-purple-300/30 bg-purple-300/12'
                    : 'border border-transparent hover:bg-white/5'
                }`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium ${editProvider === p.id ? 'text-purple-100' : 'text-slate-200'}`}>
                    {p.name}
                  </p>
                  <p className="text-[10px] leading-4 text-slate-500">{p.description}</p>
                </div>
                {editProvider === p.id ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-purple-300" />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Model selector */}
        <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Model</p>
          {currentProviderMeta && currentProviderMeta.models.length > 0 ? (
            <>
              <select
                value={editModel}
                onChange={(e) => { setEditModel(e.target.value); setStatus('idle') }}
                disabled={saving}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-purple-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                {currentProviderMeta.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.description ? ` — ${m.description}` : ''}
                  </option>
                ))}
                <option value="__custom__">自定义模型…</option>
              </select>
              {editModel === '__custom__' ? (
                <input
                  type="text"
                  value=""
                  onChange={(e) => { setEditModel(e.target.value); setStatus('idle') }}
                  placeholder="输入模型 ID（如 claude-opus-4-8）"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-purple-300/50"
                />
              ) : null}
            </>
          ) : (
            <input
              type="text"
              value={editModel}
              onChange={(e) => { setEditModel(e.target.value); setStatus('idle') }}
              disabled={saving}
              placeholder={currentProviderMeta ? '输入模型 ID' : 'claude-sonnet-4-6'}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-purple-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
            />
          )}
        </div>

        {/* API Key */}
        {currentProviderMeta?.requiresApiKey ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">API Key</p>
              {apiKeys[editProvider] ? (
                <span className="text-[10px] text-slate-500">已设置 {apiKeys[editProvider]}</span>
              ) : null}
            </div>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={editApiKey}
                  onChange={(e) => { setEditApiKey(e.target.value); setApiKeyDirty(true); setStatus('idle') }}
                  disabled={saving}
                  placeholder={currentProviderMeta.apiKeyEnvVar || 'API Key'}
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-purple-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
                  tabIndex={-1}
                >
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
              留空则使用环境变量 {currentProviderMeta.apiKeyEnvVar}
            </p>
          </div>
        ) : null}

        {errorMsg ? (
          <p className="text-[11px] leading-relaxed text-rose-300">{errorMsg}</p>
        ) : null}

        {/* Apply button */}
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={!dirty || saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition enabled:hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        >
          <RotateCw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
          {saving ? '应用中...' : '应用并重启后端'}
        </button>
      </div>
    </div>
  )
}
