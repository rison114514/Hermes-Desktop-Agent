import { useEffect, useMemo, useState } from 'react'
import { Cable, ChevronLeft, ChevronRight, ExternalLink, Globe, History, MessageSquarePlus, Puzzle, Wrench } from 'lucide-react'
import { SkillList } from './SkillList'
import { ModelConfig } from './ModelConfig'
import { ProxyConfig } from './ProxyConfig'
import { SessionHistoryCard } from './SessionHistoryCard'
import { ModPanel } from '@/components/ModPanel'
import { SSHPanel } from '@/components/SSHPanel'
import { TodoPanel } from '@/components/TodoPanel'
import { DisciplinePanel } from '@/components/DisciplinePanel'
import { CollapsibleCard } from '@/components/CollapsibleCard'
import { DraggableCard } from '@/components/DraggableCard'
import { useSidebarStore } from '@/store/sidebar'
import { useModsStore } from '@/store/mods'
import { useChatStore } from '@/store/chat'
import { useSessionStore } from '@/store/sessions'
import { useWorkspaceStore } from '@/store/workspace'

const CARDS: Record<string, React.FC> = {
  sessions: () => (
    <CollapsibleCard
      id="sessions"
      icon={<History className="h-3.5 w-3.5" />}
      title="历史会话"
      accentClass="text-cyan-300"
      defaultOpen={true}
    >
      <SessionHistoryCard />
    </CollapsibleCard>
  ),
  skills: () => (
    <CollapsibleCard
      id="skills"
      icon={<Wrench className="h-3.5 w-3.5" />}
      title="工具路由"
      accentClass="text-amber-300"
      defaultOpen={true}
    >
      <div className="max-h-64 overflow-y-auto pr-0.5">
        <SkillList />
      </div>
    </CollapsibleCard>
  ),
  model: () => (
    <CollapsibleCard
      id="model"
      icon={<Cable className="h-3.5 w-3.5" />}
      title="模型配置"
      accentClass="text-purple-300"
    >
      <ModelConfig />
    </CollapsibleCard>
  ),
  proxy: () => (
    <CollapsibleCard
      id="proxy"
      icon={<Globe className="h-3.5 w-3.5" />}
      title="网络代理"
      accentClass="text-emerald-300"
    >
      <ProxyConfig />
    </CollapsibleCard>
  ),
  mods: () => (
    <CollapsibleCard
      id="mods"
      icon={<Puzzle className="h-3.5 w-3.5" />}
      title="扩展模块"
      accentClass="text-fuchsia-300"
    >
      <ModPanel />
    </CollapsibleCard>
  ),
}

// Mini persona-list panel used by MOD panel cards
function PersonaListPanelInline({ modName, emptyText }: { modName: string; emptyText: string }) {
  const [personas, setPersonas] = useState<Array<{ id: string; name: string; icon: string; description: string; active: boolean }>>([])
  const modsReadyNonce = useModsStore((s) => s.modsReadyNonce)
  const openTab = useSessionStore((state) => state.openTab)

  useEffect(() => {
    if (!window.hermesDesktop?.personaList) return
    window.hermesDesktop.personaList().then(setPersonas).catch(() => { /* noop */ })
  }, [modsReadyNonce])

  const handleSwitch = async (personaId: string) => {
    if (!window.hermesDesktop?.personaSwitch) return
    await window.hermesDesktop.personaSwitch(personaId)
    window.hermesDesktop.personaList().then(setPersonas).catch(() => { /* noop */ })
  }

  const openPersonaDetail = (persona: { id: string; name: string }) => {
    openTab({
      id: `mod:hermes-persona:persona-editor:${persona.id}`,
      kind: 'mod',
      modName,
      rendererType: 'persona-editor',
      name: `人格 · ${persona.name}`,
      payload: { personaId: persona.id },
      closable: true,
    })
  }

  return (
    <div className="space-y-2">
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
              <span className="text-base">{iconEmojiForPersona(p.icon)}</span>
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
  )
}

function iconEmojiForPersona(icon: string): string {
  switch (icon) {
    case 'pen': return '✍️'
    case 'code': return '💻'
    case 'book': return '📖'
    case 'bot': return '🤖'
    default: return '🧩'
  }
}

// Individual MOD panel renderers keyed by `mod-panel-<modName>`.
// Each enabled MOD that exposes a sidebar panel gets its own draggable card.
function renderModPanelCard(modName: string): React.FC {
  // Simple lookup: map known MOD panel types to components
  return function ModPanelCardWrapper() {
    const mods = useModsStore((state) => state.mods)
    const mod = mods.find((m) => m.name === modName)
    if (!mod?.enabled || !mod.exports?.panels?.sidebar) return null
    const panel = mod.exports.panels.sidebar as Record<string, unknown>
    const panelType = String(panel.type || 'info')
    const title = String(panel.title || mod.manifest.name || mod.name)

    const content = (() => {
      if (panelType === 'ssh-manager') return <SSHPanel />
      if (panelType === 'todo-list') return <TodoPanel />
      if (panelType === 'discipline-board') return <DisciplinePanel />
      if (panelType === 'persona-list') {
        return <PersonaListPanelInline modName={modName} emptyText={String(panel.emptyText || '未找到人格定义')} />
      }
      return (
        <div>
          <p className="text-xs text-emerald-100/80">{String(panel.content || '')}</p>
          <p className="mt-2 text-[10px] text-slate-500">via {modName}</p>
        </div>
      )
    })()

    return (
      <CollapsibleCard
        id={`mod-panel-${modName}`}
        icon={<Puzzle className="h-3.5 w-3.5" />}
        title={title}
        accentClass="text-fuchsia-300"
      >
        {content}
      </CollapsibleCard>
    )
  }
}

type SkillsPanelProps = {
  width?: number
}

export function SkillsPanel({ width = 320 }: SkillsPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [startingSession, setStartingSession] = useState(false)
  const order = useSidebarStore((state) => state.order)
  const moveCard = useSidebarStore((state) => state.moveCard)
  const setOrder = useSidebarStore((state) => state.setOrder)
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const resetForSession = useChatStore((state) => state.resetForSession)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const moveSessionMessages = useChatStore((state) => state.moveSessionMessages)
  const mods = useModsStore((state) => state.mods)

  // Auto-register enabled MOD panel cards in the sidebar order
  const modPanelIds = useMemo(() =>
    mods
      .filter((m) => m.enabled && m.exports?.panels?.sidebar)
      .map((m) => `mod-panel-${m.name}`),
  [mods])
  useEffect(() => {
    let changed = false
    const next = [...order]
    for (const id of modPanelIds) {
      if (!next.includes(id)) { next.push(id); changed = true }
    }
    if (changed) setOrder(next)
  }, [modPanelIds, order, setOrder])

  // Dynamic CARDS that includes MOD panel cards alongside static cards
  const allCards = useMemo(() => {
    const dynamic: Record<string, React.FC> = {}
    for (const mod of mods) {
      if (mod.enabled && mod.exports?.panels?.sidebar) {
        dynamic[`mod-panel-${mod.name}`] = renderModPanelCard(mod.name)
      }
    }
    return { ...CARDS, ...dynamic }
  }, [mods])

  const handleNewSession = async () => {
    if (!window.hermesDesktop) return
    setStartingSession(true)

    const tempId = `new-${Date.now()}`
    const sid = useSessionStore.getState()
    sid.openTab({ id: tempId, kind: 'session', sessionId: tempId, name: '新会话', cwd: '' })
    setActiveSession(tempId)
    resetForSession('新会话', tempId)

    try {
      const result = await window.hermesDesktop.createSession('新会话')
      if (result?.id) {
        moveSessionMessages(tempId, result.id)
        useSessionStore.getState().replaceTab(tempId, {
          id: result.id,
          kind: 'session',
          sessionId: result.id,
          name: result.name,
          cwd: result.cwd,
        })
        setActiveSession(result.id)
        await window.hermesDesktop.switchSession(result.id)
      }
      const snapshot = await window.hermesDesktop.newHermesSession()
      setSnapshot(snapshot)
    } catch {
      useSessionStore.getState().removeSession(tempId)
    } finally {
      setStartingSession(false)
    }
  }

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-white/10 bg-[var(--gradient-skills)] py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-amber-300/30 hover:text-amber-200"
          title="展开技能面板"
          aria-label="展开技能面板"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-white/10 bg-[var(--gradient-skills)] px-5 py-5"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => void handleNewSession()}
        disabled={startingSession}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl p-1 text-left transition enabled:hover:bg-white/5 disabled:cursor-not-allowed"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-3xl bg-emerald-300/15 text-emerald-200">
          <MessageSquarePlus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">Hermes</p>
          <h2 className="text-lg font-semibold text-white">
            {startingSession ? '启动中...' : '开始新会话'}
          </h2>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setCollapsed(true) }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-amber-300/30 hover:text-amber-200"
          title="折叠侧栏"
          aria-label="折叠侧栏"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </button>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {order.map((cardId) => {
          const Card = allCards[cardId]
          if (!Card) return null
          return (
            <DraggableCard key={cardId} id={cardId} onMove={moveCard}>
              <Card />
            </DraggableCard>
          )
        })}
      </div>
    </aside>
  )
}
