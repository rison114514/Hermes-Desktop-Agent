import { useEffect, useState } from 'react'
import { ExternalLink, PackageOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useModsStore } from '@/store/mods'
import type { LoadedMod } from '@/store/mods'
import { SSHPanel } from '@/components/SSHPanel'
import { TodoPanel } from '@/components/TodoPanel'
import { DisciplinePanel } from '@/components/DisciplinePanel'
import { useSessionStore } from '@/store/sessions'

export function ModPanel() {
  const mods = useModsStore((state) => state.mods)
  const toggleMod = useModsStore((state) => state.toggleMod)
  const removeMod = useModsStore((state) => state.removeMod)
  const openTab = useSessionStore((state) => state.openTab)
  const [scanning, setScanning] = useState(false)

  // Auto-scan on mount
  useEffect(() => {
    void handleScan()
  }, [])

  const handleScan = async () => {
    if (!window.hermesDesktop?.scanMods) return
    setScanning(true)
    try {
      const result = await window.hermesDesktop.scanMods()
      useModsStore.getState().setMods(result)
    } finally {
      setScanning(false)
    }
  }

  const handleToggle = async (mod: LoadedMod) => {
    const nextEnabled = !mod.enabled
    toggleMod(mod.name, nextEnabled)
    if (window.hermesDesktop?.toggleMod) {
      await window.hermesDesktop.toggleMod(mod.name, nextEnabled)
    }
  }

  const handleRemove = async (mod: LoadedMod) => {
    if (!window.hermesDesktop?.uninstallMod) return
    await window.hermesDesktop.uninstallMod(mod.path)
    removeMod(mod.name)
  }

  const openModTab = (mod: LoadedMod, tab: { id: string; title: string; rendererType: string; icon?: string; payload?: Record<string, unknown> }) => {
    openTab({
      id: `mod:${mod.name}:${tab.id}`,
      kind: 'mod',
      modName: mod.name,
      rendererType: tab.rendererType,
      name: tab.title,
      icon: tab.icon,
      payload: tab.payload,
      closable: true,
    })
  }

  const enabledCount = mods.filter((m) => m.enabled).length
  const enabledSummary = mods.length > 0
    ? `已启用 ${enabledCount}/${mods.length}`
    : '暂无模组'

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{enabledSummary}</p>
        <button
          type="button"
          onClick={() => void handleScan()}
          disabled={scanning}
          className="flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-1 text-[11px] text-violet-100 transition enabled:hover:bg-violet-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        >
          <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
          扫描
        </button>
      </div>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {mods.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-center">
            <PackageOpen className="mx-auto mb-2 h-5 w-5 text-slate-500" />
            <p className="text-xs text-slate-500">暂无模组</p>
            <p className="mt-1 text-[11px] text-slate-600">点击"扫描"检测 mods 目录</p>
          </div>
        ) : (
          mods.map((mod) => (
            <div
              key={mod.name}
              className={`rounded-2xl border px-4 py-3 transition ${
                mod.error
                  ? 'border-rose-300/20 bg-rose-400/8'
                  : 'border-white/10 bg-slate-950/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-100">{mod.manifest.name}</p>
                    {mod.manifest.version ? (
                      <span className="shrink-0 text-[11px] text-slate-600">v{mod.manifest.version}</span>
                    ) : null}
                  </div>
                  {mod.manifest.description ? (
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{mod.manifest.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleToggle(mod)}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                      mod.enabled
                        ? 'border border-emerald-300/30 bg-emerald-300/15 text-emerald-100'
                        : 'border border-white/10 bg-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {mod.enabled ? '已启用' : '禁用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove(mod)}
                    className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-transparent text-slate-500 transition hover:border-rose-300/30 hover:text-rose-200"
                    title="卸载模组"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {mod.error ? (
                <p className="mt-2 rounded-xl border border-rose-300/10 bg-rose-400/5 px-3 py-1.5 text-[11px] leading-4 text-rose-200/70">
                  {mod.error}
                </p>
              ) : null}
              {mod.enabled && mod.exports?.tabs?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mod.exports.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => openModTab(mod, tab)}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {tab.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Renders sidebar panels from enabled MODs
export function ModSidebarPanels() {
  const mods = useModsStore((state) => state.mods)
  const panels = mods.filter((m) => m.enabled && m.exports?.panels?.sidebar)

  if (panels.length === 0) return null

  return (
    <>
      {panels.map((mod) => {
        const panel = mod.exports!.panels!.sidebar as Record<string, unknown>
        const panelType = String(panel.type || 'info')

        if (panelType === 'persona-list') {
          return <PersonaListPanel key={mod.name} modName={mod.name} title={String(panel.title || '人格')} emptyText={String(panel.emptyText || '未找到人格定义')} />
        }

        if (panelType === 'ssh-manager') {
          return <SSHPanel key={mod.name} />
        }

        if (panelType === 'todo-list') {
          return <TodoPanel key={mod.name} />
        }

        if (panelType === 'discipline-board') {
          return <DisciplinePanel key={mod.name} />
        }

        // Default info panel
        return (
          <div key={mod.name} className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/8 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">{String(panel.title || mod.name)}</p>
            <p className="mt-1 text-xs text-emerald-100/80">{String(panel.content || '')}</p>
            <p className="mt-2 text-[10px] text-slate-500">via {mod.name}</p>
          </div>
        )
      })}
    </>
  )
}

function PersonaListPanel({ title, emptyText }: { modName: string; title: string; emptyText: string }) {
  const [personas, setPersonas] = useState<Array<{ id: string; name: string; icon: string; description: string; active: boolean }>>([])
  const openTab = useSessionStore((state) => state.openTab)

  // Re-fetch on mount and whenever the backend signals MODs are ready, so the
  // active persona loads even if this panel mounted before the mod IPC handlers
  // were registered.
  const modsReadyNonce = useModsStore((s) => s.modsReadyNonce)
  useEffect(() => {
    refreshList()
  }, [modsReadyNonce])

  const refreshList = async () => {
    if (!window.hermesDesktop?.personaList) return
    try {
      const list = await window.hermesDesktop.personaList()
      setPersonas(list)
    } catch { /* noop */ }
  }

  const handleSwitch = async (personaId: string) => {
    if (!window.hermesDesktop?.personaSwitch) return
    await window.hermesDesktop.personaSwitch(personaId)
    await refreshList()
  }

  const openPersonaDetail = (persona: { id: string; name: string }) => {
    openTab({
      id: `mod:hermes-persona:persona-editor:${persona.id}`,
      kind: 'mod',
      modName: 'hermes-persona',
      rendererType: 'persona-editor',
      name: `人格 · ${persona.name}`,
      payload: { personaId: persona.id },
      closable: true,
    })
  }

  return (
    <div className="mt-3 rounded-[28px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{title}</p>
      <div className="mt-3 space-y-2">
        {personas.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">{emptyText}</p>
        ) : (
          personas.map((p) => (
            <div
              key={p.id}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                p.active
                  ? 'border-amber-300/30 bg-amber-300/12'
                  : 'border-white/10 bg-slate-950/80 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{iconEmoji(p.icon)}</span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void handleSwitch(p.active ? '' : p.id)}
                    className={`block text-left text-sm font-medium ${p.active ? 'text-amber-100' : 'text-slate-100'}`}
                  >
                    {p.name}
                    {p.active ? <span className="ml-1.5 text-[11px] text-amber-200/70">当前</span> : null}
                  </button>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{p.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openPersonaDetail(p)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-slate-500 transition hover:text-fuchsia-200"
                  title="打开详情"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function iconEmoji(icon: string): string {
  switch (icon) {
    case 'pen': return '✍️'
    case 'code': return '💻'
    case 'book': return '📖'
    case 'bot': return '🤖'
    default: return '🧩'
  }
}
