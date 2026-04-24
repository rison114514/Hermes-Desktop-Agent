import { CheckCircle2, Circle } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace'

export function TaskList() {
  const tasks = useWorkspaceStore((state) => state.tasks)

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <div className="mb-4 text-sm font-semibold text-white">任务列表</div>
      <div className="space-y-3 text-sm text-slate-300">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
            {task.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            ) : (
              <Circle className="h-4 w-4 text-slate-500" />
            )}
            <span>{task.title}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
