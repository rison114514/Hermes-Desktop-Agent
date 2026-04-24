import { Layers3 } from 'lucide-react'
import { SkillList } from './SkillList'
import { ModelConfig } from './ModelConfig'

export function SkillsPanel() {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.92))] px-5 py-5">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-3xl bg-amber-300/15 text-amber-200">
          <Layers3 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Skills</p>
          <h2 className="text-lg font-semibold text-white">Tool routing</h2>
        </div>
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
