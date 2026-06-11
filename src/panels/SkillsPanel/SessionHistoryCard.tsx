import { useEffect, useRef, useState, useCallback } from 'react'
import { Pencil, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'
import { useSessionStore } from '@/store/sessions'

type HermesSessionInfo = {
  sessionId: string
  cwd: string
  title?: string
  updatedAt?: string
}

const PAGE_SIZE = 10

export function SessionHistoryCard() {
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const resetForSession = useChatStore((state) => state.resetForSession)
  const tabSessions = useSessionStore((state) => state.sessions)
  const activeTabId = useSessionStore((state) => state.activeId)
  const switchTab = useSessionStore((state) => state.setActive)

  const [sessions, setSessions] = useState<HermesSessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const editRef = useRef<HTMLInputElement>(null)

  // Track which tabs map to which ACP sessions (best-effort, in component scope)
  const sessionTabMap = useRef<Map<string, string>>(new Map())

  const refreshSessions = useCallback(async () => {
    if (!window.hermesDesktop) return
    setLoading(true)
    try {
      const list = await window.hermesDesktop.listHermesSessions()
      setSessions(list)
    } catch {
      // Backend not ready or error — silently keep current/empty list
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const visibleSessions = sessions.slice(0, displayCount)
  const hasMore = sessions.length > displayCount

  const handleLoadSession = async (session: HermesSessionInfo) => {
    if (!window.hermesDesktop) return

    const tabName = session.title || session.sessionId.slice(0, 16)

    // Check if this session is already open in a tab
    const mappedTabId = sessionTabMap.current.get(session.sessionId)
    if (mappedTabId) {
      const tabExists = tabSessions.some((t) => t.id === mappedTabId)
      if (tabExists) {
        switchTab(mappedTabId)
        window.hermesDesktop.switchSession(mappedTabId).catch(() => {})
        return
      }
      sessionTabMap.current.delete(session.sessionId)
    }

    setLoadingId(session.sessionId)
    try {
      // 1. Create tab instantly (bridge starts in background)
      const result = await window.hermesDesktop.createSession(tabName, session.cwd)
      const tabId = result?.id ?? activeTabId ?? 'default'

      // Register the new tab in the frontend session store so the TabBar
      // renders it. addSession also sets activeId atomically.
      // We use getState() inside the async handler to avoid stale-closure
      // issues (same pattern as handleNewSession in SkillsPanel/index.tsx).
      useSessionStore.getState().addSession({
        id: tabId,
        name: result?.name ?? tabName,
        cwd: result?.cwd ?? session.cwd,
      })

      // 2. Switch UI + backend to the tab immediately.
      //    Must await the backend switch so loadHermesSession targets the
      //    correct bridge — otherwise the first load after creating a tab
      //    races and lands on the previous active bridge.
      switchTab(tabId)
      await window.hermesDesktop.switchSession(tabId)
      if (tabId !== (activeTabId ?? 'default')) {
        sessionTabMap.current.set(session.sessionId, tabId)
      }

      // 3. Show placeholder in chat right away
      resetForSession(tabName, tabId)

      // 4. Load session content — the active bridge is now the new tab's bridge
      const snapshot = await window.hermesDesktop.loadHermesSession(session.sessionId, session.cwd)
      setSnapshot(snapshot)
    } catch (err) {
      console.warn('[SessionHistory] failed to load session:', err instanceof Error ? err.message : err)
    } finally {
      setLoadingId(null)
    }
  }

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.hermesDesktop) return
    if (!confirm('确定要删除此会话吗？此操作不可撤销。')) return
    setLoadingId(sessionId)
    try {
      const result = await window.hermesDesktop.deleteHermesSession(sessionId)
      if (!result.ok) {
        alert(`删除失败: ${result.error ?? '未知错误'}`)
        return
      }
      sessionTabMap.current.delete(sessionId)
      await refreshSessions()
    } finally {
      setLoadingId(null)
    }
  }

  const handleStartRename = (session: HermesSessionInfo, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(session.sessionId)
    setEditTitle(session.title || session.sessionId.slice(0, 16))
    setTimeout(() => editRef.current?.focus(), 0)
  }

  const handleConfirmRename = async () => {
    if (!window.hermesDesktop || !editingId) return
    const title = editTitle.trim()
    if (!title) {
      setEditingId(null)
      return
    }
    setLoadingId(editingId)
    try {
      const result = await window.hermesDesktop.renameHermesSession(editingId, title)
      if (!result.ok) {
        alert(`重命名失败: ${result.error ?? '未知错误'}`)
        return
      }
      await refreshSessions()
    } finally {
      setLoadingId(null)
      setEditingId(null)
      setEditTitle('')
    }
  }

  const handleCancelRename = () => {
    setEditingId(null)
    setEditTitle('')
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void refreshSessions()}
          disabled={loading}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 disabled:cursor-not-allowed"
          title="刷新会话列表"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="flex-1 text-[11px] text-slate-500">
          {sessions.length > 0 ? `${sessions.length} 个会话` : ''}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">
          {loading ? '加载中...' : '暂无历史会话'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visibleSessions.map((item) => {
            const isLoading = loadingId === item.sessionId
            const isEditing = editingId === item.sessionId
            return (
              <div
                key={item.sessionId}
                onClick={() => void handleLoadSession(item)}
                className="group flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 transition hover:bg-white/5"
              >
                <Terminal className="h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-cyan-300/70" />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={editRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleConfirmRename()
                        if (e.key === 'Escape') handleCancelRename()
                      }}
                      onBlur={() => handleCancelRename()}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded-md border border-cyan-300/30 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-100 outline-none"
                    />
                  ) : (
                    <p
                      className="truncate text-xs font-medium text-slate-200"
                      onDoubleClick={(e) => handleStartRename(item, e)}
                      title="双击重命名"
                    >
                      {item.title || item.sessionId.slice(0, 16)}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.cwd}</p>
                </div>
                {isLoading ? (
                  <span className="shrink-0 text-[11px] text-slate-500">...</span>
                ) : (
                  <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(item, e)}
                      disabled={isLoading}
                      className="grid h-6 w-6 place-items-center rounded-full text-slate-500 transition hover:text-amber-300 disabled:cursor-not-allowed"
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void handleDeleteSession(item.sessionId, e)}
                      disabled={isLoading}
                      className="grid h-6 w-6 place-items-center rounded-full text-slate-500 transition hover:text-rose-300 disabled:cursor-not-allowed"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {hasMore ? (
            <button
              type="button"
              onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
              className="w-full rounded-xl py-2 text-center text-xs text-slate-500 transition hover:text-cyan-300"
            >
              查看更多 ({sessions.length - displayCount} 个剩余)
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
