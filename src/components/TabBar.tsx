import { useEffect, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useSessionStore } from '@/store/sessions'
import type { SessionTab } from '@/store/sessions'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'
import { useSkillsStore } from '@/store/skills'
import { cn } from '@/lib/utils'

export function TabBar() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const setSessions = useSessionStore((s) => s.setSessions)
  const setActive = useSessionStore((s) => s.setActive)
  const addSession = useSessionStore((s) => s.addSession)
  const removeSession = useSessionStore((s) => s.removeSession)
  const setActiveChat = useChatStore((s) => s.setActiveSession)
  const setSnapshot = useWorkspaceStore((s) => s.setSnapshot)
  const setCommands = useSkillsStore((s) => s.setCommands)
  const [initializing, setInitializing] = useState<Set<string>>(new Set())

  // Load existing sessions on mount. The default session is registered only
  // after the backend warms up, so retry a few times until it appears instead
  // of leaving the tab bar empty when we win the startup race.
  useEffect(() => {
    if (!window.hermesDesktop?.listSessions) return
    let cancelled = false
    let attempts = 0

    const load = () => {
      window.hermesDesktop.listSessions().then((list) => {
        if (cancelled) return
        if (list.length > 0) {
          // Merge with any optimistic tabs already created in this session.
          const existing = useSessionStore.getState().sessions
          const merged = [
            ...list,
            ...existing.filter((tab) => !list.some((s) => s.id === tab.id)),
          ]
          setSessions(merged)
          // Only force an active tab when nothing is selected yet.
          if (!useSessionStore.getState().activeId && list[0]?.id) {
            setActive(list[0].id)
            setActiveChat(list[0].id)
          }
          return
        }
        if (attempts++ < 20) {
          setTimeout(load, 300)
        }
      }).catch(() => {
        if (!cancelled && attempts++ < 20) {
          setTimeout(load, 300)
        }
      })
    }

    load()
    return () => { cancelled = true }
  }, [setSessions, setActive, setActiveChat])

  const handleNew = () => {
    // Optimistic: create tab immediately
    const tempId = `new-${Date.now()}`
    const tempTab: SessionTab = { id: tempId, name: '新会话', cwd: '' }
    addSession(tempTab)
    setActiveChat(tempId)
    setInitializing((s) => new Set(s).add(tempId))

    // Spawn backend in background
    window.hermesDesktop?.createSession?.(`会话 ${sessions.length + 1}`)
      .then((session) => {
        if (session) {
          // Replace temp tab with real session
          useSessionStore.setState((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === tempId ? { id: session.id, name: session.name, cwd: session.cwd } : s,
            ),
            activeId: state.activeId === tempId ? session.id : state.activeId,
          }))
          setActiveChat(session.id)
          setInitializing((s) => { const n = new Set(s); n.delete(tempId); return n })
        }
      })
      .catch(() => {
        removeSession(tempId)
        setInitializing((s) => { const n = new Set(s); n.delete(tempId); return n })
      })
  }

  const handleClose = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (sessions.length <= 1) return
    if (!window.hermesDesktop?.closeSession) return
    await window.hermesDesktop.closeSession(id)
    removeSession(id)
  }

  const handleClick = (s: SessionTab) => {
    if (initializing.has(s.id)) return
    setActive(s.id)
    setActiveChat(s.id)
    // Switching tabs must also pull in the target session's workspace context
    // (file tree, cwd, slash commands), not just its chat history.
    window.hermesDesktop?.switchSession?.(s.id).then((result) => {
      if (result?.snapshot) setSnapshot(result.snapshot)
      if (result?.commands) setCommands(result.commands)
    }).catch(() => {})
  }

  return (
    <div className="flex items-center border-b border-white/10 bg-slate-950/60 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1">
        {sessions.map((s) => {
          const isInit = initializing.has(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleClick(s)}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs transition',
                s.id === activeId
                  ? 'border-t border-x border-white/10 bg-[var(--gradient-chat)] text-slate-100'
                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-300',
                isInit && 'opacity-60',
              )}
              title={isInit ? '正在启动...' : `${s.name} — ${s.cwd}`}
            >
              {isInit ? (
                <Loader2 className="h-3 w-3 animate-spin text-cyan-200" />
              ) : null}
              <span className="max-w-[120px] truncate">{isInit ? '启动中...' : s.name}</span>
              {sessions.length > 1 && !isInit ? (
                <span
                  onClick={(e) => handleClose(s.id, e)}
                  className="grid h-4 w-4 place-items-center rounded-full opacity-0 transition hover:bg-white/10 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={handleNew}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-300"
        title="新建会话"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
