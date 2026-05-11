import { useEffect, useState } from 'react'
import { ChevronRight, FileCode2, FolderTree, LoaderCircle } from 'lucide-react'
import type { WorkspaceFileNode } from '@/store/workspace'
import { useWorkspaceStore } from '@/store/workspace'
import { cn } from '@/lib/utils'

function TreeNode({ node, depth = 0 }: { node: WorkspaceFileNode; depth?: number }) {
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths)
  const selectedFilePath = useWorkspaceStore((state) => state.selectedFilePath)
  const toggleExpandedPath = useWorkspaceStore((state) => state.toggleExpandedPath)
  const setDirectoryChildren = useWorkspaceStore((state) => state.setDirectoryChildren)
  const setSelectedFilePath = useWorkspaceStore((state) => state.setSelectedFilePath)
  const [loading, setLoading] = useState(false)
  const isDirectory = node.type === 'directory'
  const isExpanded = expandedPaths.includes(node.path)

  const loadDirectory = async () => {
    if (!window.hermesDesktop || !isDirectory || node.children) {
      return
    }

    setLoading(true)
    try {
      const result = await window.hermesDesktop.readWorkspaceDirectory(node.path)
      if (result.ok && result.files) {
        setDirectoryChildren(node.path, result.files)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isDirectory && isExpanded && !node.children) {
      void loadDirectory()
    }
  }, [isDirectory, isExpanded, node.children, node.path])

  const handleClick = async () => {
    if (isDirectory) {
      if (!isExpanded && !node.children) {
        await loadDirectory()
      }
      toggleExpandedPath(node.path)
      return
    }

    setSelectedFilePath(node.path)
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition',
          selectedFilePath === node.path
            ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-50'
            : 'border-white/6 bg-slate-950/50 text-slate-200 hover:border-white/12 hover:bg-slate-900/80',
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        title={node.path}
      >
        {isDirectory ? (
          <>
            {loading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-cyan-200" />
            ) : (
              <ChevronRight className={cn('h-3.5 w-3.5 text-slate-500 transition', isExpanded && 'rotate-90')} />
            )}
            <FolderTree className="h-4 w-4 text-cyan-200" />
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <FileCode2 className="h-4 w-4 text-amber-200" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDirectory && isExpanded && node.children?.length ? (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
      {isDirectory && isExpanded && node.children && node.children.length === 0 ? (
        <div
          className="mt-2 rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-3 py-2 text-xs text-slate-500"
          style={{ marginLeft: `${12 + (depth + 1) * 14}px` }}
        >
          Empty
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
