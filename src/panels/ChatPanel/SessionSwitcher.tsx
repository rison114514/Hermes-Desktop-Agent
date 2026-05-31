import { useEffect, useRef, useState } from 'react'
import { History, MessageSquarePlus, RefreshCw, Terminal } from 'lucide-react'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'

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
      resetForSession(`Loading ACP session ${session.title || session.sessionId}...`)
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
            return (
              <div
                key={item.sessionId}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {item.title || item.sessionId.slice(0, 16)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{item.cwd}</p>
                  {item.updatedAt ? (
                    <p className="mt-0.5 text-[11px] text-slate-600">{item.updatedAt}</p>
                  ) : null}
                </div>
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
