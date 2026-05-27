import { useState } from 'react'
import { ChevronLeft, ChevronRight, LayoutPanelTop, RefreshCw } from 'lucide-react'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'
import { SessionInfo } from './SessionInfo'
import { useWorkspaceStore } from '@/store/workspace'

export function WorkspacePanel() {
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const selectedFilePath = useWorkspaceStore((state) => state.selectedFilePath)
  const setPreview = useWorkspaceStore((state) => state.setPreview)
  const setPreviewLoading = useWorkspaceStore((state) => state.setPreviewLoading)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const handleRefresh = async () => {
    if (!window.hermesDesktop || refreshing) {
      return
    }

    setRefreshing(true)
    try {
      const snapshot = await window.hermesDesktop.getWorkspaceSnapshot()
      setSnapshot(snapshot)
      await refreshSelectedPreview(selectedFilePath, setPreview, setPreviewLoading)
    } finally {
      setRefreshing(false)
    }
  }

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.95),rgba(15,23,42,0.92))] py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200"
          title="展开工作区面板"
          aria-label="展开工作区面板"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-[24rem] shrink-0 flex-col border-l border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.95),rgba(15,23,42,0.92))] px-5 py-5">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-3xl bg-rose-300/15 text-rose-200">
            <LayoutPanelTop className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">工作区</p>
            <h2 className="truncate text-lg font-semibold text-white">上下文与任务</h2>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || !window.hermesDesktop}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition enabled:hover:border-rose-200/30 enabled:hover:bg-rose-200/10 disabled:cursor-not-allowed disabled:text-slate-600"
            title="刷新工作区上下文"
            aria-label="刷新工作区上下文"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200"
            title="折叠工作区面板"
            aria-label="折叠工作区面板"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4 overflow-y-auto pr-1">
        <FileTree />
        <FilePreview />
        <SessionInfo />
      </div>
    </aside>
  )
}

async function refreshSelectedPreview(
  selectedFilePath: string | null,
  setPreview: ReturnType<typeof useWorkspaceStore.getState>['setPreview'],
  setPreviewLoading: ReturnType<typeof useWorkspaceStore.getState>['setPreviewLoading'],
) {
  if (!window.hermesDesktop || !selectedFilePath) {
    return
  }

  setPreviewLoading(true)
  try {
    const result = await window.hermesDesktop.readWorkspaceFile(selectedFilePath)
    if (!result.ok || !result.path || typeof result.content !== 'string' || !result.language) {
      setPreview(null)
      return
    }

    setPreview({
      path: result.path,
      content: result.content,
      language: result.language,
      truncated: Boolean(result.truncated),
    })
  } finally {
    setPreviewLoading(false)
  }
}
