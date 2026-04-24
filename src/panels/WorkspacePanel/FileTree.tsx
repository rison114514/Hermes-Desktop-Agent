import { ChevronRight, FileCode2, FolderTree } from 'lucide-react'
import type { WorkspaceFileNode } from '@/store/workspace'
import { useWorkspaceStore } from '@/store/workspace'

function TreeNode({ node, depth = 0 }: { node: WorkspaceFileNode; depth?: number }) {
  const isDirectory = node.type === 'directory'

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-2 text-sm text-slate-200"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        title={node.path}
      >
        {isDirectory ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            <FolderTree className="h-4 w-4 text-cyan-200" />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <FileCode2 className="h-4 w-4 text-amber-200" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isDirectory && node.children?.length ? (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FileTree() {
  const files = useWorkspaceStore((state) => state.files)

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <FolderTree className="h-4 w-4 text-cyan-200" />
        文件结构
      </div>
      <div className="space-y-2">
        {files.length ? (
          files.map((file) => <TreeNode key={file.path} node={file} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
            当前工作区暂无可展示文件。
          </div>
        )}
      </div>
    </section>
  )
}
