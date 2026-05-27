import { useState } from 'react'
import { ChevronLeft, ChevronRight, Layers3 } from 'lucide-react'
import { SkillList } from './SkillList'
import { ModelConfig } from './ModelConfig'

export function SkillsPanel() {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.92))] py-3">
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
    <aside className="flex w-80 shrink-0 flex-col border-r border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.92))] px-5 py-5">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-3xl bg-amber-300/15 text-amber-200">
          <Layers3 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">技能</p>
          <h2 className="text-lg font-semibold text-white">工具路由</h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-amber-300/30 hover:text-amber-200"
          title="折叠技能面板"
          aria-label="折叠技能面板"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <SkillList />
      </div>

      <div className="mt-5">
        <ModelConfig />
      </div>
    </aside>
  )
}
