import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PanelRight, ChevronLeft, CheckCircle2, Circle, Plus, Trash2, ListTodo,
  Clock, AlertTriangle, Calendar, Edit3, ArrowRight, X, Sparkles, Pin
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModsStore } from '@/store/mods'

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
  low: 'text-slate-400',
  medium: 'text-amber-200',
  high: 'text-orange-300',
  critical: 'text-rose-300',
}
const URGENCY_LABELS: Record<string, string> = {
  low: '低', medium: '中', high: '高', critical: '紧急',
}
const IMPORTANCE_LABELS: Record<string, string> = {
  low: '☆', medium: '★', high: '★★',
}

const PANEL_WIDTH = 380
const PANEL_GAP = 12

export function TodoPanel() {
  const [tasks, setTasks] = useState<TodoItem[]>([])
  const [open, setOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  // Ticking clock so DDL countdowns update live while the panel is open.
  const [nowMs, setNowMs] = useState(Date.now())

  // Add form
  const [newTitle, setNewTitle] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  // Detail editor
  const [editTitle, setEditTitle] = useState('')
  const [editDetail, setEditDetail] = useState('')
  const [editUrgency, setEditUrgency] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [editImportance, setEditImportance] = useState<'low' | 'medium' | 'high'>('medium')
  const [editDdl, setEditDdl] = useState('')

  const triggerRef = useRef<HTMLDivElement>(null)

  // Re-fetch on mount and whenever the backend signals MODs are ready, so the
  // saved tasks load even if this panel mounted before the mod IPC handlers
  // were registered.
  const modsReadyNonce = useModsStore((s) => s.modsReadyNonce)
  useEffect(() => { refreshList() }, [modsReadyNonce])

  const callMod = async (method: string, args?: Record<string, unknown>) => {
    if (!window.hermesDesktop?.callModIpc) return null
    return window.hermesDesktop.callModIpc('hermes-todo', method, args)
  }

  const refreshList = async () => {
    const r = await callMod('list')
    if (Array.isArray(r)) setTasks(r)
  }

  // Anchor the flyout beside the trigger card, clamped to the viewport so it
  // can overlay/overflow beyond the sidebar without going off-screen.
  const computePos = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const maxHeight = Math.min(640, window.innerHeight - 32)
    let left = r.right + PANEL_GAP
    if (left + PANEL_WIDTH > window.innerWidth - PANEL_GAP) {
      left = Math.max(PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP)
    }
    let top = r.top
    if (top + maxHeight > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - maxHeight - 16)
    }
    setPos({ top, left, maxHeight })
  }

  const openPanel = () => {
    computePos()
    void refreshList()
    setOpen(true)
  }

  const closePanel = () => {
    setOpen(false)
    setDetailId(null)
    setShowAddForm(false)
  }

  // Pop the memo out into the independent always-on-top desktop widget window.
  const popOutToWidget = () => {
    void window.hermesDesktop?.openTodoWidget?.()
    closePanel()
  }

  // If the open detail task disappears (cleared/removed elsewhere), drop back to the list.
  useEffect(() => {
    if (detailId !== null && !tasks.some(t => t.index === detailId)) setDetailId(null)
  }, [tasks, detailId])

  useEffect(() => {
    if (!open) return
    const onResize = () => computePos()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel() }
    const tick = setInterval(() => setNowMs(Date.now()), 1000)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(tick)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setLoading(true)
    const r = await callMod('add', { title: newTitle.trim() })
    if (r?.ok && Array.isArray(r.tasks)) setTasks(r.tasks)
    setNewTitle('')
    setShowAddForm(false)
    setLoading(false)
  }

  const handleToggle = async (index: number) => {
    await callMod('toggle', { index })
    refreshList()
  }

  const handleRemove = async (index: number) => {
    const r = await callMod('remove', { index })
    if (r?.ok && Array.isArray(r.tasks)) {
      setTasks(r.tasks)
      if (detailId === index) setDetailId(null)
    }
  }

  const handleClearDone = async () => {
    const r = await callMod('clear-done')
    if (r?.ok && Array.isArray(r.tasks)) setTasks(r.tasks)
  }

  const handleSaveDetail = async () => {
    const r = await callMod('update', {
      index: detailId,
      title: editTitle,
      detail: editDetail,
      urgency: editUrgency,
      importance: editImportance,
      ddl: editDdl || null,
    })
    if (r?.ok) { refreshList(); setDetailId(null) }
  }

  const openDetail = (t: TodoItem) => {
    setDetailId(t.index)
    setEditTitle(t.title)
    setEditDetail(t.detail || '')
    setEditUrgency(t.urgency || 'medium')
    setEditImportance(t.importance || 'medium')
    setEditDdl(t.ddl || '')
  }

  const doneCount = tasks.filter(t => t.done).length
  const activeCount = tasks.length - doneCount
  const summary = tasks.length > 0 ? `${doneCount}/${tasks.length} 已完成` : '暂无任务'
  const progress = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0

  const sortTasks = (list: TodoItem[]) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return [...list].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const ua = order[a.urgency || 'medium'] ?? 2
      const ub = order[b.urgency || 'medium'] ?? 2
      return ua - ub
    })
  }

  const sortedTasks = sortTasks(tasks)
  const detailTask = detailId !== null ? tasks.find(t => t.index === detailId) : undefined

  return (
    <>
      {/* Trigger card — stays in the sidebar */}
      <div
        ref={triggerRef}
        className={cn(
          'rounded-[28px] border bg-white/5 p-4 transition',
          open ? 'border-amber-300/40 bg-amber-300/[0.06]' : 'border-white/10',
        )}
      >
        <button
          type="button"
          onClick={() => (open ? closePanel() : openPanel())}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-300/15 text-amber-200">
              <ListTodo className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">备忘</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{summary}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeCount > 0 ? (
              <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                {activeCount}
              </span>
            ) : null}
            <PanelRight className={cn('h-4 w-4 text-slate-400 transition', open ? 'text-amber-200' : '')} />
          </div>
        </button>

        {/* Slim progress hint on the collapsed card */}
        {tasks.length > 0 ? (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-emerald-400/60 transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>

      {/* Side flyout overlay — escapes the sidebar via position: fixed */}
      <AnimatePresence>
        {open && pos ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closePanel}
            />
            <motion.div
              className="fixed z-50 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.maxHeight }}
              initial={{ opacity: 0, x: -12, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -12, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {detailId !== null && detailTask ? (
                <DetailView
                  editTitle={editTitle} setEditTitle={setEditTitle}
                  editDetail={editDetail} setEditDetail={setEditDetail}
                  editUrgency={editUrgency} setEditUrgency={setEditUrgency}
                  editImportance={editImportance} setEditImportance={setEditImportance}
                  editDdl={editDdl} setEditDdl={setEditDdl}
                  nowMs={nowMs}
                  onBack={() => setDetailId(null)}
                  onSave={handleSaveDetail}
                  onDelete={() => handleRemove(detailId)}
                />
              ) : (
                <ListView
                  summary={summary}
                  progress={progress}
                  hasTasks={tasks.length > 0}
                  doneCount={doneCount}
                  sortedTasks={sortedTasks}
                  nowMs={nowMs}
                  loading={loading}
                  newTitle={newTitle} setNewTitle={setNewTitle}
                  showAddForm={showAddForm} setShowAddForm={setShowAddForm}
                  onAdd={handleAdd}
                  onToggle={handleToggle}
                  onOpenDetail={openDetail}
                  onClearDone={handleClearDone}
                  onClose={closePanel}
                  onPopOut={popOutToWidget}
                />
              )}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  )
}

interface ListViewProps {
  summary: string
  progress: number
  hasTasks: boolean
  doneCount: number
  sortedTasks: TodoItem[]
  nowMs: number
  loading: boolean
  newTitle: string
  setNewTitle: (v: string) => void
  showAddForm: boolean
  setShowAddForm: (v: boolean) => void
  onAdd: () => void
  onToggle: (index: number) => void
  onOpenDetail: (t: TodoItem) => void
  onClearDone: () => void
  onClose: () => void
  onPopOut: () => void
}

function ListView({
  summary, progress, hasTasks, doneCount, sortedTasks, nowMs, loading,
  newTitle, setNewTitle, showAddForm, setShowAddForm,
  onAdd, onToggle, onOpenDetail, onClearDone, onClose, onPopOut,
}: ListViewProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-amber-300/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-amber-300/15 text-amber-200">
            <ListTodo className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">备忘清单</p>
            <p className="text-[11px] text-slate-500">{summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPopOut}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-amber-300/40 hover:text-amber-200"
            title="钉到桌面（独立悬浮窗）"
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {hasTasks ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-400/60 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-slate-500">{summary}</span>
          </div>
        ) : null}

        {/* Add */}
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-slate-500 transition hover:border-amber-300/30 hover:text-amber-100"
          >
            <Plus className="h-3.5 w-3.5" /> 添加任务
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void onAdd() }}
              placeholder="任务标题" autoFocus
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-300/50"
            />
            <button
              type="button" onClick={() => void onAdd()} disabled={loading || !newTitle.trim()}
              className="shrink-0 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition hover:bg-amber-300/18 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button" onClick={() => { setShowAddForm(false); setNewTitle('') }}
              className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
            >
              取消
            </button>
          </div>
        )}

        {/* List */}
        <div className="space-y-1.5">
          {sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Sparkles className="h-6 w-6 text-slate-600" />
              <p className="text-xs text-slate-500">暂无任务，点击上方添加</p>
            </div>
          ) : (
            sortedTasks.map(t => {
              const isOverdue = t.ddl && !t.done && new Date(t.ddl).getTime() < nowMs
              return (
                <div
                  key={t.index}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition',
                    t.done
                      ? 'border-transparent opacity-40'
                      : isOverdue
                        ? 'border-rose-400/25 bg-rose-400/5'
                        : 'border-white/5 bg-slate-950/40 hover:border-white/10 hover:bg-white/5',
                  )}
                >
                  <button
                    type="button" onClick={() => onToggle(t.index)}
                    className="shrink-0 text-slate-400 transition hover:text-emerald-200"
                  >
                    {t.done ? <CheckCircle2 className="h-4 w-4 text-emerald-200/70" /> : <Circle className="h-4 w-4" />}
                  </button>

                  <button type="button" onClick={() => onOpenDetail(t)} className="min-w-0 flex-1 text-left">
                    <span className={cn('text-xs', t.done ? 'text-slate-500 line-through' : 'text-slate-200')}>
                      {t.title}
                    </span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {t.urgency && t.urgency !== 'medium' ? (
                        <span className={cn('text-[9px]', URGENCY_COLORS[t.urgency])}>
                          <AlertTriangle className="inline h-2.5 w-2.5" /> {URGENCY_LABELS[t.urgency]}
                        </span>
                      ) : null}
                      {t.importance && t.importance !== 'medium' ? (
                        <span className="text-[9px] text-amber-200/70">{IMPORTANCE_LABELS[t.importance]}</span>
                      ) : null}
                      {t.ddl ? (
                        <span className={cn('text-[9px]', isOverdue ? 'text-rose-300' : 'text-slate-500')}>
                          <Clock className="inline h-2.5 w-2.5" /> {formatDdl(t.ddl, nowMs)}
                        </span>
                      ) : null}
                      {t.detail ? (
                        <span className="max-w-[120px] truncate text-[9px] text-slate-600">{t.detail.slice(0, 40)}</span>
                      ) : null}
                    </div>
                  </button>

                  <button
                    type="button" onClick={() => onOpenDetail(t)}
                    className="shrink-0 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:text-amber-200"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Footer */}
      {doneCount > 0 ? (
        <div className="border-t border-white/10 px-4 py-2.5">
          <button
            type="button" onClick={() => void onClearDone()}
            className="w-full rounded-xl border border-white/10 bg-transparent py-1.5 text-[11px] text-slate-500 transition hover:border-rose-300/25 hover:text-rose-200"
          >
            <Trash2 className="mr-1 inline h-3 w-3" /> 清除已完成 ({doneCount})
          </button>
        </div>
      ) : null}
    </>
  )
}

interface DetailViewProps {
  editTitle: string; setEditTitle: (v: string) => void
  editDetail: string; setEditDetail: (v: string) => void
  editUrgency: 'low' | 'medium' | 'high' | 'critical'; setEditUrgency: (v: 'low' | 'medium' | 'high' | 'critical') => void
  editImportance: 'low' | 'medium' | 'high'; setEditImportance: (v: 'low' | 'medium' | 'high') => void
  editDdl: string; setEditDdl: (v: string) => void
  nowMs: number
  onBack: () => void
  onSave: () => void
  onDelete: () => void
}

function DetailView({
  editTitle, setEditTitle, editDetail, setEditDetail,
  editUrgency, setEditUrgency, editImportance, setEditImportance,
  editDdl, setEditDdl, nowMs, onBack, onSave, onDelete,
}: DetailViewProps) {
  const quickDdl = (offset: { days?: number; months?: number }) => {
    const d = new Date()
    if (offset.months) d.setMonth(d.getMonth() + offset.months)
    if (offset.days) d.setDate(d.getDate() + offset.days)
    d.setHours(23, 59, 0, 0)
    setEditDdl(toLocalDatetimeInput(d))
  }
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-gradient-to-r from-amber-300/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={onBack}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">任务详情</p>
        </div>
        <button
          type="button" onClick={onDelete}
          className="grid h-7 w-7 place-items-center rounded-full border border-rose-300/20 bg-rose-300/10 text-rose-200 transition hover:bg-rose-300/20"
          title="删除任务"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <input
          type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm font-medium text-slate-100 outline-none focus:border-amber-300/50"
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">紧急度</p>
            <div className="flex gap-1">
              {(['low', 'medium', 'high', 'critical'] as const).map(level => (
                <button
                  key={level} type="button" onClick={() => setEditUrgency(level)}
                  className={cn('flex-1 rounded-lg py-1 text-[10px] transition',
                    editUrgency === level
                      ? 'border border-amber-300/30 bg-amber-300/15 text-amber-100'
                      : 'border border-transparent text-slate-500 hover:text-slate-300')}
                >
                  {URGENCY_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">重要度</p>
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as const).map(level => (
                <button
                  key={level} type="button" onClick={() => setEditImportance(level)}
                  className={cn('flex-1 rounded-lg py-1 text-[10px] transition',
                    editImportance === level
                      ? 'border border-amber-300/30 bg-amber-300/15 text-amber-100'
                      : 'border border-transparent text-slate-500 hover:text-slate-300')}
                >
                  {level === 'low' ? '☆' : level === 'medium' ? '★' : '★★'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <Calendar className="mr-1 inline h-3 w-3" />DDL
            </p>
            {editDdl ? (
              <span className={cn('text-[10px] font-medium',
                new Date(editDdl).getTime() < nowMs ? 'text-rose-300' : 'text-amber-200')}>
                <Clock className="mr-0.5 inline h-2.5 w-2.5" />{formatDdl(editDdl, nowMs)}
              </span>
            ) : null}
          </div>
          {/* One-click common deadlines */}
          <div className="mb-2 flex flex-wrap gap-1">
            {([
              { label: '1天', offset: { days: 1 } },
              { label: '3天', offset: { days: 3 } },
              { label: '1周', offset: { days: 7 } },
              { label: '1月', offset: { months: 1 } },
            ] as const).map(q => (
              <button
                key={q.label} type="button" onClick={() => quickDdl(q.offset)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300 transition hover:border-amber-300/30 hover:text-amber-100"
              >
                +{q.label}
              </button>
            ))}
            {editDdl ? (
              <button
                type="button" onClick={() => setEditDdl('')}
                className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-500 transition hover:border-rose-300/30 hover:text-rose-200"
              >
                清除
              </button>
            ) : null}
          </div>
          <input
            type="datetime-local" value={editDdl} onChange={e => setEditDdl(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none [color-scheme:dark] focus:border-amber-300/50"
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <Edit3 className="mr-1 inline h-3 w-3" />详细描述
          </p>
          <textarea
            value={editDetail} onChange={e => setEditDetail(e.target.value)}
            rows={6} placeholder="任务详情、子步骤、备注..."
            className="w-full resize-none rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-300/50"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 py-3">
        <button
          type="button" onClick={onSave}
          className="w-full rounded-xl border border-emerald-300/25 bg-emerald-300/10 py-2 text-xs text-emerald-100 transition hover:bg-emerald-300/18"
        >
          保存
        </button>
      </div>
    </>
  )
}

// Format a datetime-local string ("YYYY-MM-DDTHH:mm") from a Date in local time.
function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Live, granular DDL countdown. Falls back to a date label when far out.
function formatDdl(ddl: string, nowMs: number = Date.now()): string {
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
