import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight, Copy, ExternalLink, FileCode2, FolderOpen, FolderTree, LoaderCircle, Pencil } from 'lucide-react'
import type { WorkspaceFileNode } from '@/store/workspace'
import { useWorkspaceStore } from '@/store/workspace'
import { cn } from '@/lib/utils'

type ContextMenuState = {
  node: WorkspaceFileNode
  x: number
  y: number
} | null

function TreeNode({
  node,
  depth = 0,
  onContextMenu,
}: {
  node: WorkspaceFileNode
  depth?: number
  onContextMenu: (event: MouseEvent, node: WorkspaceFileNode) => void
}) {
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
        onContextMenu={(event) => onContextMenu(event, node)}
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
            <TreeNode key={child.path} node={child} depth={depth + 1} onContextMenu={onContextMenu} />
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
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const setSelectedFilePath = useWorkspaceStore((state) => state.setSelectedFilePath)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const openContextMenu = (event: MouseEvent, node: WorkspaceFileNode) => {
    event.preventDefault()
    setContextMenu({ node, x: event.clientX, y: event.clientY })
  }

  const runAction = async (action: () => Promise<void>) => {
    setContextMenu(null)
    try {
      await action()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Workspace action failed.')
    }
  }

  const copyAbsolutePath = async (node: WorkspaceFileNode) => {
    const result = await window.hermesDesktop.getWorkspaceItemPaths(node.path)
    if (!result.ok || !result.path) {
      throw new Error(result.error ?? 'Failed to resolve path.')
    }

    await window.hermesDesktop.writeWindowsClipboard(result.path)
    setStatus('Copied absolute path.')
  }

  const renameItem = async (node: WorkspaceFileNode) => {
    const nextName = window.prompt('Rename workspace item', node.name)
    if (!nextName || nextName === node.name) {
      return
    }

    const result = await window.hermesDesktop.renameWorkspaceItem(node.path, nextName)
    if (!result.ok || !result.snapshot) {
      throw new Error(result.error ?? 'Rename failed.')
    }

    setSnapshot(result.snapshot)
    if (node.type === 'file' && result.path) {
      setSelectedFilePath(result.path)
    }
    setStatus(`Renamed to ${nextName}.`)
  }

  return (
    <section className="relative rounded-[28px] border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <FolderTree className="h-4 w-4 text-cyan-200" />
        文件结构
      </div>
      <div className="space-y-2">
        {files.length ? (
          files.map((file) => <TreeNode key={file.path} node={file} onContextMenu={openContextMenu} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
            当前工作区暂无可展示文件。
          </div>
        )}
      </div>
      {status ? <p className="mt-3 text-xs text-slate-500">{status}</p> : null}

      {contextMenu ? (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 py-2 text-sm text-slate-200 shadow-[0_24px_60px_rgba(0,0,0,0.36)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <ContextMenuButton
            icon={<FolderOpen className="h-4 w-4" />}
            label="在文件资源管理器打开"
            onClick={() => void runAction(async () => {
              const result = await window.hermesDesktop.revealWorkspaceItem(contextMenu.node.path)
              if (!result.ok) {
                throw new Error(result.error ?? 'Reveal failed.')
              }
              setStatus('Revealed in Explorer.')
            })}
          />
          <ContextMenuButton
            icon={<ExternalLink className="h-4 w-4" />}
            label="打开"
            onClick={() => void runAction(async () => {
              const result = await window.hermesDesktop.openWorkspaceItem(contextMenu.node.path)
              if (!result.ok) {
                throw new Error(result.error ?? 'Open failed.')
              }
              setStatus('Opened item.')
            })}
          />
          <ContextMenuButton
            icon={<Pencil className="h-4 w-4" />}
            label="重命名"
            onClick={() => void runAction(() => renameItem(contextMenu.node))}
          />
          <ContextMenuButton
            icon={<Copy className="h-4 w-4" />}
            label="复制路径"
            onClick={() => void runAction(() => copyAbsolutePath(contextMenu.node))}
          />
          <ContextMenuButton
            icon={<Copy className="h-4 w-4" />}
            label="复制相对路径"
            onClick={() => void runAction(async () => {
              await window.hermesDesktop.writeWindowsClipboard(contextMenu.node.path)
              setStatus('Copied relative path.')
            })}
          />
        </div>
      ) : null}
    </section>
  )
}

function ContextMenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-white/[0.07] hover:text-white"
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
