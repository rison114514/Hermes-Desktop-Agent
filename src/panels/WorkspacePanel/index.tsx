import { LayoutPanelTop } from 'lucide-react'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'
import { TaskList } from './TaskList'
import { SessionInfo } from './SessionInfo'

export function WorkspacePanel() {
  return (
    <aside className="flex w-[24rem] shrink-0 flex-col border-l border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.95),rgba(15,23,42,0.92))] px-5 py-5">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-3xl bg-rose-300/15 text-rose-200">
          <LayoutPanelTop className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">工作区</p>
          <h2 className="text-lg font-semibold text-white">上下文与任务</h2>
        </div>
      </div>

      <div className="space-y-4 overflow-y-auto pr-1">
        <FileTree />
        <FilePreview />
        <TaskList />
        <SessionInfo />
      </div>
    </aside>
  )
}
