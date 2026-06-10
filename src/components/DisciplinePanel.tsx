import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PanelRight, ChevronLeft, ChevronRight, CheckCircle2, Circle, Calendar,
  Clock, Edit3, X, Sparkles, RefreshCw, BarChart3, Target,
  AlertCircle, Star, Settings, Plus, Trash2, Copy
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModsStore } from '@/store/mods'
import type { DailyPlan, DayTemplate, SlotStatus, Weekday } from '@/store/discipline'

const PANEL_WIDTH = 440
const PANEL_GAP = 12
const WEEKDAY_LABELS: Record<number, string> = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' }
const WEEKDAY_FULL: Record<number, string> = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' }

function todayStr(): string { return new Date().toISOString().slice(0, 10) }
function formatDate(dateStr: string): string { const d = new Date(dateStr + 'T00:00:00'); return (d.getMonth() + 1) + '月' + d.getDate() + '日' }
function dayOfWeekNum(dateStr: string): number { return new Date(dateStr + 'T00:00:00').getDay() }
function isToday(dateStr: string): boolean { return dateStr === todayStr() }

function statusIcon(status: SlotStatus) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-300" />
  if (status === 'missed') return <AlertCircle className="h-4 w-4 text-rose-300" />
  return <Circle className="h-4 w-4 text-slate-500" />
}
function statusLabel(status: SlotStatus): string {
  if (status === 'completed') return '已完成'; if (status === 'missed') return '未完成'; return '待完成'
}
function progressPercent(plan: DailyPlan): number {
  const total = plan.schedule.length + plan.dailyGoals.length; if (total === 0) return 0
  return Math.round(((plan.schedule.filter(s => s.status === 'completed').length + plan.dailyGoals.filter(g => g.status === 'completed').length) / total) * 100)
}
function summaryColorBg(color: string): string {
  if (color === 'green') return 'border-emerald-300/40 bg-emerald-400/10'
  if (color === 'orange') return 'border-amber-300/40 bg-amber-400/10'
  return 'border-rose-300/40 bg-rose-400/10'
}
function summaryColorText(color: string): string {
  if (color === 'green') return 'text-emerald-200'; if (color === 'orange') return 'text-amber-200'; return 'text-rose-200'
}

export function DisciplinePanel() {
  const [planCache, setPlanCache] = useState<Map<string, DailyPlan>>(new Map())
  const [templates, setTemplates] = useState<DayTemplate[]>([])
  const [currentDate, setCurrentDate] = useState(todayStr())
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<DayTemplate | null>(null)
  const [tmplSchedule, setTmplSchedule] = useState<Array<{ timeSlot: string; title: string }>>([])
  const [tmplGoals, setTmplGoals] = useState<Array<{ title: string }>>([])
  const [tmplTargets, setTmplTargets] = useState<Weekday[]>([])

  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [editingGoal, setEditingGoal] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editStatus, setEditStatus] = useState<SlotStatus>('pending')
  const [editTimeSlot, setEditTimeSlot] = useState('')

  const triggerRef = useRef<HTMLDivElement>(null)
  const plan = planCache.get(currentDate) ?? null

  const modsReadyNonce = useModsStore((s) => s.modsReadyNonce)
  useEffect(() => { if (open) loadPlan(currentDate) }, [modsReadyNonce])

  useEffect(() => {
    if (!window.hermesDesktop?.onHermesEvent) return
    return window.hermesDesktop.onHermesEvent((event) => {
      if ((event as { type: string }).type === 'discipline:updated') loadPlan(currentDate, true)
    })
  }, [currentDate])

  const callMod = async (method: string, args?: Record<string, unknown>) => {
    if (!window.hermesDesktop?.callModIpc) return null
    return window.hermesDesktop.callModIpc('hermes-discipline', method, args) as Promise<Record<string, unknown> | null>
  }

  const loadPlan = async (date: string, force = false) => {
    if (!force && planCache.has(date)) return
    setLoading(true)
    const r = await callMod('get-plan', { date })
    if (r?.ok && r.plan) {
      setPlanCache(prev => new Map(prev).set(date, r.plan as DailyPlan))
      if (r.templates) setTemplates(r.templates as DayTemplate[])
    }
    setLoading(false)
  }

  const preloadNearby = (date: string) => {
    const d = new Date(date + 'T00:00:00')
    for (let i = -2; i <= 2; i++) {
      const nd = new Date(d); nd.setDate(nd.getDate() + i)
      const ds = nd.toISOString().slice(0, 10)
      if (!planCache.has(ds)) { const p = loadPlan(ds); void p }
    }
  }

  useEffect(() => { if (!open) return; const tick = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(tick) }, [open])

  const computePos = () => {
    const el = triggerRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    const maxH = Math.min(700, window.innerHeight - 32)
    let left = r.right + PANEL_GAP
    if (left + PANEL_WIDTH > window.innerWidth - PANEL_GAP) left = Math.max(PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP)
    let top = r.top
    if (top + maxH > window.innerHeight - 16) top = Math.max(16, window.innerHeight - maxH - 16)
    setPos({ top, left, maxHeight: maxH })
  }

  const openPanel = () => { computePos(); void loadPlan(currentDate); preloadNearby(currentDate); setOpen(true) }
  const closePanel = () => { setOpen(false); setEditingSlot(null); setEditingGoal(null); setShowTemplateModal(false) }

  useEffect(() => {
    if (!open) return
    const onResize = () => computePos(); const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel() }
    window.addEventListener('resize', onResize); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey) }
  }, [open])

  const navigateDate = useCallback((delta: number) => {
    const d = new Date(currentDate + 'T00:00:00'); d.setDate(d.getDate() + delta)
    const newDate = d.toISOString().slice(0, 10)
    setCurrentDate(newDate); preloadNearby(newDate); void loadPlan(newDate, true)
  }, [currentDate, planCache])

  const goToday = () => { const td = todayStr(); setCurrentDate(td); void loadPlan(td, true) }

  const toggleSlot = async (index: number) => {
    if (!plan) return
    const ns: SlotStatus = plan.schedule[index].status === 'completed' ? 'pending' : 'completed'
    await callMod('update-schedule', { date: currentDate, index, status: ns }); void loadPlan(currentDate, true)
  }
  const toggleGoal = async (index: number) => {
    if (!plan) return
    const ns: SlotStatus = plan.dailyGoals[index].status === 'completed' ? 'pending' : 'completed'
    await callMod('update-goal', { date: currentDate, index, status: ns }); void loadPlan(currentDate, true)
  }
  const saveSlotEdit = async () => {
    if (editingSlot === null || !plan) return
    await callMod('update-schedule', { date: currentDate, index: editingSlot, title: editTitle, description: editDescription, status: editStatus, timeSlot: editTimeSlot })
    setEditingSlot(null); void loadPlan(currentDate, true)
  }
  const saveGoalEdit = async () => {
    if (editingGoal === null || !plan) return
    await callMod('update-goal', { date: currentDate, index: editingGoal, title: editTitle, description: editDescription, status: editStatus })
    setEditingGoal(null); void loadPlan(currentDate, true)
  }
  const requestAISummary = async () => { await callMod('request-summary', { date: currentDate }); void loadPlan(currentDate, true) }

  const openTemplateEditor = (tmpl?: DayTemplate) => {
    if (tmpl) {
      setEditingTemplate(tmpl); setTmplSchedule(tmpl.schedule.map(s => ({ ...s })))
      setTmplGoals(tmpl.dailyGoals.map(g => ({ ...g }))); setTmplTargets([...(tmpl.weekdayTargets || [])])
    } else {
      setEditingTemplate({ id: 'custom-' + Date.now(), name: '', schedule: [], dailyGoals: [], weekdayTargets: [] })
      setTmplSchedule([{ timeSlot: '09:00-12:00', title: '新计划' }]); setTmplGoals([{ title: '新目标' }]); setTmplTargets([])
    }
    setShowTemplateModal(true)
  }

  const addTmplSlot = () => setTmplSchedule([...tmplSchedule, { timeSlot: '', title: '' }])
  const removeTmplSlot = (i: number) => setTmplSchedule(tmplSchedule.filter((_, idx) => idx !== i))
  const updateTmplSlot = (i: number, field: 'timeSlot' | 'title', value: string) => { const next = [...tmplSchedule]; next[i] = { ...next[i], [field]: value }; setTmplSchedule(next) }
  const addTmplGoal = () => setTmplGoals([...tmplGoals, { title: '' }])
  const removeTmplGoal = (i: number) => setTmplGoals(tmplGoals.filter((_, idx) => idx !== i))
  const updateTmplGoal = (i: number, value: string) => { const next = [...tmplGoals]; next[i] = { title: value }; setTmplGoals(next) }
  const toggleTmplTarget = (d: Weekday) => setTmplTargets(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  const selectAllWeekdays = () => setTmplTargets([1, 2, 3, 4, 5])
  const selectAllWeekends = () => setTmplTargets([0, 6])
  const selectAllDays = () => setTmplTargets([0, 1, 2, 3, 4, 5, 6])

  const saveTemplate = async () => {
    if (!editingTemplate) return
    const tmpl: DayTemplate = { ...editingTemplate, name: editingTemplate.name || '未命名模板', schedule: tmplSchedule.filter(s => s.timeSlot || s.title), dailyGoals: tmplGoals.filter(g => g.title), weekdayTargets: tmplTargets }
    await callMod('save-template', { template: tmpl })
    const r = await callMod('get-templates'); if (r?.ok && r.templates) setTemplates(r.templates as DayTemplate[])
    setShowTemplateModal(false)
  }

  const deleteTemplate = async (id: string) => { await callMod('delete-template', { id }); const r = await callMod('get-templates'); if (r?.ok && r.templates) setTemplates(r.templates as DayTemplate[]) }

  const applyTemplateToDates = async (templateId: string, dates: string[]) => {
    await callMod('apply-template', { templateId, dates })
    const next = new Map(planCache); dates.forEach(d => next.delete(d)); setPlanCache(next); void loadPlan(currentDate, true)
  }

  const thisWeekDates = useMemo(() => {
    const today = new Date(); const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const dates: string[] = []
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); dates.push(d.toISOString().slice(0, 10)) }
    return dates
  }, [])

  const progress = plan ? progressPercent(plan) : 0
  const doneCount = plan ? plan.schedule.filter(s => s.status === 'completed').length + plan.dailyGoals.filter(g => g.status === 'completed').length : 0
  const totalCount = plan ? plan.schedule.length + plan.dailyGoals.length : 0

  return (
    <>
      <div ref={triggerRef} className={cn('rounded-[28px] border bg-white/5 p-4 transition', open ? 'border-emerald-300/40 bg-emerald-300/[0.06]' : 'border-white/10')}>
        <button type="button" onClick={() => open ? closePanel() : openPanel()} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><Calendar className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">自律打卡</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{plan ? formatDate(currentDate) + ' \xb7 ' + doneCount + '/' + totalCount : '加载中...'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {totalCount > 0 ? <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">{progress}%</span> : null}
            <PanelRight className={cn('h-4 w-4 text-slate-400 transition', open ? 'text-emerald-200' : '')} />
          </div>
        </button>
        {totalCount > 0 ? <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400/60 transition-all" style={{ width: progress + '%' }} /></div> : null}
      </div>
      <AnimatePresence>
        {open && pos ? (<>
          <motion.div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={closePanel} />
          <motion.div className="fixed z-50 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.maxHeight }}
            initial={{ opacity: 0, x: -12, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -12, scale: 0.98 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-emerald-300/10 to-transparent px-4 py-3 shrink-0">
              <div className="flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><Calendar className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-slate-100">自律打卡</p><p className="text-[11px] text-slate-500">{plan ? doneCount + '/' + totalCount + ' 完成 (' + progress + '%)' : '加载中...'}</p></div></div>
              <div className="flex items-center gap-1.5">
                {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
                <button onClick={() => openTemplateEditor()} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 hover:border-purple-300/40 hover:text-purple-200" title="管理模板"><Settings className="h-3.5 w-3.5" /></button>
                <button onClick={closePanel} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 hover:border-rose-300/30 hover:text-rose-200" title="关闭"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex items-center justify-between">
                <button onClick={() => navigateDate(-1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition"><ChevronLeft className="h-4 w-4" /></button>
                <div className="text-center"><button onClick={goToday} className="text-sm font-medium text-slate-100 hover:text-emerald-200 transition">{formatDate(currentDate)} 周{WEEKDAY_LABELS[dayOfWeekNum(currentDate)]}</button>{isToday(currentDate) ? <span className="ml-1.5 rounded-full bg-emerald-300/15 px-1.5 py-0.5 text-[10px] text-emerald-200">今天</span> : null}</div>
                <button onClick={() => navigateDate(1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition"><ChevronRight className="h-4 w-4" /></button>
              </div>
              {totalCount > 0 ? <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400/60 transition-all duration-500" style={{ width: progress + '%' }} /></div><span className="text-[10px] text-slate-500 shrink-0">{progress}%</span></div> : null}
              <div>
                <div className="flex items-center gap-2 mb-2"><Clock className="h-3.5 w-3.5 text-sky-200" /><p className="text-xs font-medium text-slate-300">每日时间计划</p></div>
                {!plan || plan.schedule.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-6 text-center"><Clock className="mx-auto h-5 w-5 text-slate-600 mb-1" /><p className="text-[11px] text-slate-500">暂无计划</p><button onClick={() => openTemplateEditor()} className="mt-2 text-[10px] text-purple-300 hover:text-purple-200 transition">打开模板管理 →</button></div> : <div className="space-y-1.5">{plan.schedule.map((slot, i) => <div key={i} className={cn('group rounded-xl border px-3 py-2.5 transition', slot.status === 'completed' ? 'border-emerald-300/20 bg-emerald-400/5' : slot.status === 'missed' ? 'border-rose-300/20 bg-rose-400/5' : 'border-white/5 bg-slate-950/40 hover:border-white/10')}><div className="flex items-center gap-2.5"><button onClick={() => toggleSlot(i)} className="shrink-0 transition hover:scale-110">{statusIcon(slot.status)}</button><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[11px] text-slate-400 shrink-0">{slot.timeSlot}</span><span className={cn('text-xs truncate', slot.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-200')}>{slot.title}</span><span className={cn('text-[9px] shrink-0', slot.status === 'completed' ? 'text-emerald-300' : slot.status === 'missed' ? 'text-rose-300' : 'text-slate-600')}>{statusLabel(slot.status)}</span></div>{slot.description ? <p className="mt-1 text-[10px] text-slate-500 truncate">{slot.description}</p> : null}</div><button onClick={() => { const s = plan.schedule[i]; setEditingSlot(i); setEditTitle(s.title); setEditDescription(s.description); setEditStatus(s.status); setEditTimeSlot(s.timeSlot); setEditingGoal(null) }} className="shrink-0 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-emerald-200 transition"><Edit3 className="h-3 w-3" /></button></div></div>)}</div>}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2"><Target className="h-3.5 w-3.5 text-amber-200" /><p className="text-xs font-medium text-slate-300">每日自律目标</p></div>
                {!plan || plan.dailyGoals.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-6 text-center"><Target className="mx-auto h-5 w-5 text-slate-600 mb-1" /><p className="text-[11px] text-slate-500">暂无目标</p></div> : <div className="space-y-1.5">{plan.dailyGoals.map((goal, i) => <div key={i} className={cn('group rounded-xl border px-3 py-2.5 transition', goal.status === 'completed' ? 'border-emerald-300/20 bg-emerald-400/5' : goal.status === 'missed' ? 'border-rose-300/20 bg-rose-400/5' : 'border-white/5 bg-slate-950/40 hover:border-white/10')}><div className="flex items-center gap-2.5"><button onClick={() => toggleGoal(i)} className="shrink-0 transition hover:scale-110">{statusIcon(goal.status)}</button><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={cn('text-xs truncate', goal.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-200')}>{goal.title}</span><span className={cn('text-[9px] shrink-0', goal.status === 'completed' ? 'text-emerald-300' : goal.status === 'missed' ? 'text-rose-300' : 'text-slate-600')}>{statusLabel(goal.status)}</span></div>{goal.description ? <p className="mt-1 text-[10px] text-slate-500 truncate">{goal.description}</p> : null}</div><button onClick={() => { const g = plan.dailyGoals[i]; setEditingGoal(i); setEditTitle(g.title); setEditDescription(g.description); setEditStatus(g.status); setEditingSlot(null) }} className="shrink-0 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-amber-200 transition"><Edit3 className="h-3 w-3" /></button></div></div>)}</div>}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2"><Sparkles className="h-3.5 w-3.5 text-purple-200" /><p className="text-xs font-medium text-slate-300">AI 总结</p></div>
                {plan?.aiSummary ? <div className={cn('rounded-xl border px-3 py-3', summaryColorBg(plan.aiSummary.color))}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Star className={cn('h-4 w-4', summaryColorText(plan.aiSummary.color))} /><span className={cn('text-sm font-bold', summaryColorText(plan.aiSummary.color))}>{plan.aiSummary.score} 分</span><span className={cn('text-[11px]', plan.aiSummary.color === 'green' ? 'text-emerald-200/70' : plan.aiSummary.color === 'orange' ? 'text-amber-200/70' : 'text-rose-200/70')}>{plan.aiSummary.color === 'green' ? '优秀' : plan.aiSummary.color === 'orange' ? '一般' : '需改进'}</span></div><span className="text-[10px] text-slate-500">{new Date(plan.aiSummary.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div><p className="mt-2 text-[11px] leading-4 text-slate-300">{plan.aiSummary.text}</p></div> : plan?.aiSummaryRequested ? <div className="rounded-xl border border-purple-300/20 bg-purple-400/5 px-3 py-4 text-center"><Sparkles className="mx-auto h-4 w-4 text-purple-300 animate-pulse" /><p className="mt-1 text-[11px] text-purple-200/70">已请求 AI 总结，请稍候...</p></div> : <button onClick={requestAISummary} className="w-full rounded-xl border border-dashed border-purple-300/25 bg-purple-300/5 px-3 py-3 text-center transition hover:border-purple-300/40 hover:bg-purple-300/10"><Sparkles className="mx-auto h-4 w-4 text-purple-300" /><p className="mt-1 text-[11px] text-purple-200/70">请求 AI 总结今日自律情况</p></button>}
              </div>
              {plan?.aiSummary ? <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2"><BarChart3 className="h-3.5 w-3.5 text-slate-400" /><p className="text-[11px] text-slate-500">日历标记：<span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', plan.aiSummary.color === 'green' ? 'bg-emerald-400/20 text-emerald-200' : plan.aiSummary.color === 'orange' ? 'bg-amber-400/20 text-amber-200' : 'bg-rose-400/20 text-rose-200')}>{plan.aiSummary.color === 'green' ? '绿色' : plan.aiSummary.color === 'orange' ? '橙色' : '红色'}</span></p></div> : null}
            </div>
          </motion.div>
        </>) : null}
      </AnimatePresence>

      {/* Template Management Modal */}
      <AnimatePresence>
        {showTemplateModal ? (<>
          <motion.div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-[1px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowTemplateModal(false)} />
          <motion.div className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[80vh] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-purple-300/10 to-transparent px-4 py-3 shrink-0">
              <div className="flex items-center gap-2"><Settings className="h-4 w-4 text-purple-200" /><p className="text-sm font-semibold text-slate-100">模板管理</p></div>
              <button onClick={() => setShowTemplateModal(false)} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2"><p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">已有模板</p><button onClick={() => openTemplateEditor()} className="flex items-center gap-1 rounded-full border border-purple-300/25 bg-purple-300/10 px-2.5 py-1 text-[11px] text-purple-100 hover:bg-purple-300/18 transition"><Plus className="h-3 w-3" /> 新建</button></div>
                {templates.length === 0 ? <p className="py-4 text-center text-[11px] text-slate-500">暂无模板</p> : <div className="space-y-1.5">{templates.map(tmpl => <div key={tmpl.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-100">{tmpl.name}</p><p className="text-[10px] text-slate-500 mt-0.5">{tmpl.schedule.length} 个时段 \xb7 {tmpl.dailyGoals.length} 个目标 \xb7 {(tmpl.weekdayTargets || []).length === 0 ? '未指定日期' : (tmpl.weekdayTargets || []).map((d: number) => WEEKDAY_FULL[d]).join('、')}</p></div><div className="flex shrink-0 items-center gap-1"><button onClick={() => { const f = thisWeekDates.filter(d => (tmpl.weekdayTargets || []).includes(dayOfWeekNum(d) as Weekday)); if (f.length > 0) { const p = applyTemplateToDates(tmpl.id, f); void p } }} className="grid h-7 w-7 place-items-center rounded-full border border-emerald-300/25 bg-emerald-300/10 text-emerald-200 hover:bg-emerald-300/18 transition" title="应用到本周"><Copy className="h-3 w-3" /></button><button onClick={() => openTemplateEditor(tmpl)} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-slate-400 hover:text-purple-200 transition"><Edit3 className="h-3 w-3" /></button><button onClick={() => deleteTemplate(tmpl.id)} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-slate-400 hover:text-rose-300 transition"><Trash2 className="h-3 w-3" /></button></div></div>)}</div>}
              </div>
              {editingTemplate ? <div className="rounded-xl border border-purple-300/20 bg-slate-950/80 p-3 space-y-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-purple-200/70">{editingTemplate.id.startsWith('custom-') ? '新建模板' : '编辑：' + editingTemplate.name}</p>
                <input value={editingTemplate.name} onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })} placeholder="模板名称" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-purple-300/50" />
                <div><p className="text-[10px] text-slate-500 mb-1.5">应用到星期</p><div className="flex items-center gap-1 flex-wrap">{([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map(d => <button key={d} onClick={() => toggleTmplTarget(d)} className={cn('rounded-full px-2.5 py-1 text-[11px] transition', tmplTargets.includes(d) ? 'border border-purple-300/30 bg-purple-300/15 text-purple-100' : 'border border-white/10 text-slate-500 hover:text-slate-300')}>{WEEKDAY_FULL[d]}</button>)}</div><div className="flex items-center gap-1 mt-1.5"><button onClick={selectAllWeekdays} className="text-[9px] text-slate-500 hover:text-slate-300 px-1">工作日</button><button onClick={selectAllWeekends} className="text-[9px] text-slate-500 hover:text-slate-300 px-1">周末</button><button onClick={selectAllDays} className="text-[9px] text-slate-500 hover:text-slate-300 px-1">全部</button></div></div>
                <div><div className="flex items-center justify-between mb-1.5"><p className="text-[10px] text-slate-500">时间计划</p><button onClick={addTmplSlot} className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-0.5"><Plus className="h-3 w-3" /> 添加</button></div><div className="space-y-1">{tmplSchedule.map((s, i) => <div key={i} className="flex items-center gap-1.5"><input value={s.timeSlot} onChange={e => updateTmplSlot(i, 'timeSlot', e.target.value)} placeholder="08:00-09:00" className="w-28 shrink-0 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-purple-300/50" /><input value={s.title} onChange={e => updateTmplSlot(i, 'title', e.target.value)} placeholder="计划标题" className="flex-1 min-w-0 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-purple-300/50" /><button onClick={() => removeTmplSlot(i)} className="shrink-0 text-slate-600 hover:text-rose-300"><X className="h-3 w-3" /></button></div>)}</div></div>
                <div><div className="flex items-center justify-between mb-1.5"><p className="text-[10px] text-slate-500">自律目标</p><button onClick={addTmplGoal} className="text-[10px] text-amber-300 hover:text-amber-200 flex items-center gap-0.5"><Plus className="h-3 w-3" /> 添加</button></div><div className="space-y-1">{tmplGoals.map((g, i) => <div key={i} className="flex items-center gap-1.5"><input value={g.title} onChange={e => updateTmplGoal(i, e.target.value)} placeholder="目标标题" className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-300/50" /><button onClick={() => removeTmplGoal(i)} className="shrink-0 text-slate-600 hover:text-rose-300"><X className="h-3 w-3" /></button></div>)}</div></div>
                <div className="flex gap-2"><button onClick={saveTemplate} className="flex-1 rounded-xl border border-purple-300/25 bg-purple-300/10 py-2 text-xs text-purple-100 hover:bg-purple-300/18 transition">保存模板</button><button onClick={() => { if (editingTemplate.id.startsWith('custom-')) setEditingTemplate(null); setShowTemplateModal(false) }} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400 hover:bg-white/10 transition">关闭</button></div>
              </div> : null}
            </div>
          </motion.div>
        </>) : null}
      </AnimatePresence>

      {/* Schedule Edit Modal */}
      <AnimatePresence>
        {editingSlot !== null && plan ? (<>
          <motion.div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-[1px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingSlot(null)} />
          <motion.div className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-2xl border border-white/10 bg-slate-900 shadow-2xl p-4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <div className="flex items-center justify-between mb-3"><p className="text-sm font-medium text-slate-100">编辑时间计划</p><button onClick={() => setEditingSlot(null)} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <div><label className="text-[10px] text-slate-500">时间段</label><input value={editTimeSlot} onChange={e => setEditTimeSlot(e.target.value)} className="w-full mt-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-300/50" /></div>
              <div><label className="text-[10px] text-slate-500">标题</label><input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full mt-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-300/50" /></div>
              <div><label className="text-[10px] text-slate-500">状态</label><div className="flex gap-1.5 mt-1">{(['pending', 'completed', 'missed'] as SlotStatus[]).map(s => <button key={s} onClick={() => setEditStatus(s)} className={cn('rounded-full px-2.5 py-1 text-[11px] transition', editStatus === s ? 'border border-emerald-300/30 bg-emerald-300/15 text-emerald-100' : 'border border-white/10 text-slate-500 hover:text-slate-300')}>{statusLabel(s)}</button>)}</div></div>
              <div><label className="text-[10px] text-slate-500">完成描述</label><textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} placeholder="描述完成情况..." className="w-full mt-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-300/50 resize-none" /></div>
              <button onClick={saveSlotEdit} className="w-full rounded-xl border border-emerald-300/25 bg-emerald-300/10 py-2 text-xs text-emerald-100 hover:bg-emerald-300/18 transition">保存</button>
            </div>
          </motion.div>
        </>) : null}
      </AnimatePresence>

      {/* Goal Edit Modal */}
      <AnimatePresence>
        {editingGoal !== null && plan ? (<>
          <motion.div className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-[1px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingGoal(null)} />
          <motion.div className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-2xl border border-white/10 bg-slate-900 shadow-2xl p-4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
            <div className="flex items-center justify-between mb-3"><p className="text-sm font-medium text-slate-100">编辑自律目标</p><button onClick={() => setEditingGoal(null)} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <div><label className="text-[10px] text-slate-500">标题</label><input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full mt-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-300/50" /></div>
              <div><label className="text-[10px] text-slate-500">状态</label><div className="flex gap-1.5 mt-1">{(['pending', 'completed', 'missed'] as SlotStatus[]).map(s => <button key={s} onClick={() => setEditStatus(s)} className={cn('rounded-full px-2.5 py-1 text-[11px] transition', editStatus === s ? 'border border-amber-300/30 bg-amber-300/15 text-amber-100' : 'border border-white/10 text-slate-500 hover:text-slate-300')}>{statusLabel(s)}</button>)}</div></div>
              <div><label className="text-[10px] text-slate-500">完成描述</label><textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} placeholder="描述完成情况..." className="w-full mt-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-amber-300/50 resize-none" /></div>
              <button onClick={saveGoalEdit} className="w-full rounded-xl border border-amber-300/25 bg-amber-300/10 py-2 text-xs text-amber-100 hover:bg-amber-300/18 transition">保存</button>
            </div>
          </motion.div>
        </>) : null}
      </AnimatePresence>
    </>
  )
}
