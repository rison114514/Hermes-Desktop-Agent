import { FolderTree } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace'

export function FileTree() {
  const files = useWorkspaceStore((state) => state.files)

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <FolderTree className="h-4 w-4 text-cyan-200" />
        文件结构
      </div>
      <div className="space-y-2 text-sm text-slate-300">
        {files.map((file) => (
          <div key={file} className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-2">
            {file}
          </div>
        ))}
      </div>
    </section>
  )
}
