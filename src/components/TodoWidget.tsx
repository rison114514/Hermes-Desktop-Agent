import { useEffect, useState, type CSSProperties } from 'react'
import {
  CheckCircle2, Circle, Plus, Trash2, ListTodo, Clock,
  AlertTriangle, Pin, PinOff, X, Sparkles, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TodoItem {
  index: number
  title: string
  detail?: string
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  importance?: 'low' | 'medium' | 'high'
  ddl?: string
  done: boolean
  createdAt?: number
}

const URGENCY_COLORS: Record<string, string> = {
  low: 'text-slate-400', medium: 'text-amber-200', high: 'text-orange-300', critical: 'text-rose-300',
}
const URGENCY_LABELS: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '紧急' }

// Electron drag regions for the frameless widget window.
const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function TodoWidget() {
  const [tasks, setTasks] = useState<TodoItem[]>([])
  const [nowMs, setNowMs] = useState(Date.now())
  const [pinned, setPinned] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(false)

  const callMod = async (method: string, args?: Record<string, unknown>) => {
    if (!window.hermesDesktop?.callModIpc) return null
    return window.hermesDesktop.callModIpc('hermes-todo', method, args)
  }

  const refreshList = async () => {
    const r = await callMod('list')
    if (Array.isArray(r)) setTasks(r as TodoItem[])
  }

  // Poll so edits made in the main panel — or by the agent through the bridge —
  // show up in the floating widget without a manual refresh.
  useEffect(() => {
    void refreshList()
    const poll = setInterval(() => void refreshList(), 4000)
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [])

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setLoading(true)
    const r = await callMod('add', { title: newTitle.trim() })
    if (r && (r as { ok?: boolean }).ok && Array.isArray((r as { tasks?: TodoItem[] }).tasks)) {
      setTasks((r as { tasks: TodoItem[] }).tasks)
    }
    setNewTitle('')
    setShowAdd(false)
    setLoading(false)
  }

  const handleToggle = async (index: number) => { await callMod('toggle', { index }); void refreshList() }

  const handleRemove = async (index: number) => {
    const r = await callMod('remove', { index })
    if (r && (r as { ok?: boolean }).ok && Array.isArray((r as { tasks?: TodoItem[] }).tasks)) {
      setTasks((r as { tasks: TodoItem[] }).tasks)
    }
  }

  const handleClearDone = async () => {
    const r = await callMod('clear-done')
    if (r && (r as { ok?: boolean }).ok && Array.isArray((r as { tasks?: TodoItem[] }).tasks)) {
      setTasks((r as { tasks: TodoItem[] }).tasks)
    }
  }

  const togglePin = async () => {
    const next = !pinned
    setPinned(next)
    await window.hermesDesktop?.setTodoWidgetPin?.(next)
  }

  const doneCount = tasks.filter(t => t.done).length
  const summary = tasks.length > 0 ? `${doneCount}/${tasks.length} 已完成` : '暂无任务'

  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return (order[a.urgency || 'medium'] ?? 2) - (order[b.urgency || 'medium'] ?? 2)
  })

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Draggable header */}
      <div
        style={DRAG}
        className="flex items-center justify-between gap-2 border-b border-white/10 bg-gradient-to-r from-amber-300/10 to-transparent px-3 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-300/15 text-amber-200">
            <ListTodo className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-100">备忘清单</p>
            <p className="truncate text-[10px] text-slate-500">{summary}</p>
          </div>
        </div>
        <div style={NO_DRAG} className="flex shrink-0 items-center gap-1">
          <button
            type="button" onClick={() => void refreshList()} title="刷新"
            className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:text-slate-200"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button" onClick={() => void togglePin()} title={pinned ? '取消置顶' : '置顶'}
            className={cn('grid h-6 w-6 place-items-center rounded-full border transition',
              pinned
                ? 'border-amber-300/40 bg-amber-300/15 text-amber-200'
                : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200')}
          >
            {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
          </button>
          <button
            type="button" onClick={() => void window.hermesDesktop?.closeTodoWidget?.()} title="关闭"
            className="grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {!showAdd ? (
          <button
            type="button" onClick={() => setShowAdd(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-slate-500 transition hover:border-amber-300/30 hover:text-amber-100"
          >
            <Plus className="h-3.5 w-3.5" /> 添加任务
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
              placeholder="任务标题" autoFocus
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-300/50"
            />
            <button
              type="button" onClick={() => void handleAdd()} disabled={loading || !newTitle.trim()}
              className="shrink-0 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition hover:bg-amber-300/18 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button" onClick={() => { setShowAdd(false); setNewTitle('') }}
              className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
            >
              取消
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles className="h-6 w-6 text-slate-600" />
              <p className="text-xs text-slate-500">暂无任务，点击上方添加</p>
            </div>
          ) : (
            sortedTasks.map(t => {
              const isOverdue = !!t.ddl && !t.done && new Date(t.ddl).getTime() < nowMs
              return (
                <div
                  key={t.index}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-xl border px-3 py-2 transition',
                    t.done
                      ? 'border-transparent opacity-40'
                      : isOverdue
                        ? 'border-rose-400/25 bg-rose-400/5'
                        : 'border-white/5 bg-slate-900/40 hover:border-white/10 hover:bg-white/5',
                  )}
                >
                  <button
                    type="button" onClick={() => void handleToggle(t.index)}
                    className="shrink-0 text-slate-400 transition hover:text-emerald-200"
                  >
                    {t.done ? <CheckCircle2 className="h-4 w-4 text-emerald-200/70" /> : <Circle className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <span className={cn('text-xs', t.done ? 'text-slate-500 line-through' : 'text-slate-200')}>
                      {t.title}
                    </span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {t.urgency && t.urgency !== 'medium' ? (
                        <span className={cn('text-[9px]', URGENCY_COLORS[t.urgency])}>
                          <AlertTriangle className="inline h-2.5 w-2.5" /> {URGENCY_LABELS[t.urgency]}
                        </span>
                      ) : null}
                      {t.ddl ? (
                        <span className={cn('text-[9px]', isOverdue ? 'text-rose-300' : 'text-slate-500')}>
                          <Clock className="inline h-2.5 w-2.5" /> {formatDdl(t.ddl, nowMs)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button" onClick={() => void handleRemove(t.index)}
                    className="shrink-0 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Footer */}
      {doneCount > 0 ? (
        <div className="border-t border-white/10 px-3 py-2">
          <button
            type="button" onClick={() => void handleClearDone()}
            className="w-full rounded-xl border border-white/10 bg-transparent py-1.5 text-[11px] text-slate-500 transition hover:border-rose-300/25 hover:text-rose-200"
          >
            <Trash2 className="mr-1 inline h-3 w-3" /> 清除已完成 ({doneCount})
          </button>
        </div>
      ) : null}
    </div>
  )
}

// Live, granular DDL countdown. Falls back to a date label when far out.
function formatDdl(ddl: string, nowMs: number): string {
  try {
    const d = new Date(ddl)
    const diff = d.getTime() - nowMs
    const overdue = diff < 0
    const abs = Math.abs(diff)
    const totalMin = Math.floor(abs / 60000)
    const days = Math.floor(totalMin / (60 * 24))
    const hours = Math.floor((totalMin % (60 * 24)) / 60)
    const mins = totalMin % 60
    if (overdue) {
      if (totalMin < 60) return `超期 ${mins} 分`
      if (days < 1) return `超期 ${hours} 时`
      return `超期 ${days} 天`
    }
    if (totalMin < 60) return `${mins} 分后`
    if (days < 1) return `${hours} 时 ${mins} 分后`
    if (days <= 7) return `${days} 天 ${hours} 时后`
    const m = (d.getMonth() + 1).toString().padStart(2, '0')
    const day = d.getDate().toString().padStart(2, '0')
    return `${m}-${day}`
  } catch { return ddl }
}
