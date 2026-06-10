import { useEffect, useRef, useState } from 'react'
import { History, MessageSquarePlus, Pencil, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'
import { useSessionStore } from '@/store/sessions'

type HermesSessionInfo = {
  sessionId: string
  cwd: string
  title?: string
  updatedAt?: string
}

export function SessionSwitcher({ onClose }: { onClose: () => void }) {
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const resetForSession = useChatStore((state) => state.resetForSession)
  const [sessions, setSessions] = useState<HermesSessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  const refreshSessions = async () => {
    if (!window.hermesDesktop) return
    setLoading(true)
    try {
      const list = await window.hermesDesktop.listHermesSessions()
      setSessions(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshSessions()
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleLoadSession = async (session: HermesSessionInfo) => {
    if (!window.hermesDesktop) return
    setLoadingId(session.sessionId)
    try {
      // Force switch to default tab — session loading only works on the default bridge
      useSessionStore.getState().setActive('default')
      useChatStore.getState().setActiveSession('default')
      resetForSession(`Loading ACP session ${session.title || session.sessionId}...`, 'default')
      const snapshot = await window.hermesDesktop.loadHermesSession(session.sessionId, session.cwd)
      setSnapshot(snapshot)
      onClose()
    } finally {
      setLoadingId(null)
    }
  }

  const handleNewSession = async () => {
    if (!window.hermesDesktop) return
    setLoadingId('new')
    try {
      resetForSession('Starting a new ACP session...')
      const snapshot = await window.hermesDesktop.newHermesSession()
      setSnapshot(snapshot)
      await refreshSessions()
      onClose()
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
    <div
      ref={ref}
      className="absolute left-0 top-full z-10 mt-2 w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <History className="h-3.5 w-3.5 text-cyan-200" />
          <span>历史会话</span>
        </div>
        <button
          type="button"
          onClick={() => void refreshSessions()}
          disabled={loading}
          className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            {loading ? '加载中...' : '暂无历史会话'}
          </div>
        ) : (
          sessions.map((item) => {
            const isLoading = loadingId === item.sessionId
            const isEditing = editingId === item.sessionId
            return (
              <div
                key={item.sessionId}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
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
                        className="w-full rounded-lg border border-cyan-300/30 bg-slate-900 px-2 py-0.5 text-sm text-slate-100 outline-none"
                      />
                    </div>
                  ) : (
                    <p
                      className="truncate text-sm font-medium text-slate-100 cursor-pointer hover:text-cyan-200 transition"
                      onDoubleClick={(e) => handleStartRename(item, e)}
                      title="双击重命名"
                    >
                      {item.title || item.sessionId.slice(0, 16)}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-xs text-slate-500">{item.cwd}</p>
                  {item.updatedAt ? (
                    <p className="mt-0.5 text-[11px] text-slate-600">{item.updatedAt}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={(e) => handleStartRename(item, e)}
                  disabled={isLoading}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition enabled:hover:border-amber-300/30 enabled:hover:text-amber-200 disabled:cursor-not-allowed disabled:text-slate-600"
                  title="重命名"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => void handleDeleteSession(item.sessionId, e)}
                  disabled={isLoading}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition enabled:hover:border-rose-300/30 enabled:hover:text-rose-200 disabled:cursor-not-allowed disabled:text-slate-600"
                  title="删除"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadSession(item)}
                  disabled={isLoading}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 transition enabled:hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                >
                  <Terminal className="h-3 w-3" />
                  {isLoading ? '加载中' : 'Load'}
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => void handleNewSession()}
          disabled={loadingId === 'new'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {loadingId === 'new' ? '启动中...' : '新对话'}
        </button>
      </div>
    </div>
  )
}
