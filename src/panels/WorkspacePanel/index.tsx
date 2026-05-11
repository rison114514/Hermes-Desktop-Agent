import { LayoutPanelTop, RefreshCw, Activity } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'
import { TaskList } from './TaskList'
import { SessionInfo } from './SessionInfo'
import { useWorkspaceStore } from '@/store/workspace'

export function WorkspacePanel() {
  const autoRefreshEnabled = useWorkspaceStore((state) => state.autoRefreshEnabled)
  const autoRefreshInterval = useWorkspaceStore((state) => state.autoRefreshInterval)
  const lastRefreshedAt = useWorkspaceStore((state) => state.lastRefreshedAt)
  const setAutoRefreshEnabled = useWorkspaceStore((state) => state.setAutoRefreshEnabled)
  const setAutoRefreshInterval = useWorkspaceStore((state) => state.setAutoRefreshInterval)
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const setLastRefreshedAt = useWorkspaceStore((state) => state.setLastRefreshedAt)

  const handleRefreshWorkspace = useCallback(async () => {
    if (!window.hermesDesktop) return
    try {
      const snapshot = await window.hermesDesktop.getWorkspaceSnapshot()
      setSnapshot(snapshot)
      setLastRefreshedAt(Date.now())
    } catch {
      // Ignore errors
    }
  }, [setSnapshot, setLastRefreshedAt])

  useEffect(() => {
    if (!autoRefreshEnabled || !window.hermesDesktop) {
      return
    }

    const intervalId = setInterval(() => {
      void window.hermesDesktop.getWorkspaceSnapshot().then((snapshot) => {
        setSnapshot(snapshot)
        setLastRefreshedAt(Date.now())
      }).catch(() => {})
    }, autoRefreshInterval)

    return () => clearInterval(intervalId)
  }, [autoRefreshEnabled, autoRefreshInterval, setSnapshot, setLastRefreshedAt])

  return (
    <aside className="flex w-[24rem] shrink-0 flex-col border-l border-white/10 bg-[linear-gradient(180deg,rgba(7,10,18,0.95),rgba(15,23,42,0.92))] px-5 py-5">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-3xl bg-rose-300/15 text-rose-200">
            <LayoutPanelTop className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">工作区</p>
            <h2 className="text-lg font-semibold text-white">上下文与任务</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefreshWorkspace()}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
            title="Refresh workspace"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] transition hover:opacity-90 ${
              autoRefreshEnabled
                ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                : 'border-white/10 bg-white/5 text-slate-400'
            }`}
          >
            <Activity className={`h-3.5 w-3.5 ${autoRefreshEnabled ? 'animate-pulse' : ''}`} />
            {autoRefreshEnabled ? 'Auto' : 'Manual'}
          </button>
        </div>
      </div>
      {autoRefreshEnabled && (
        <div className="mb-4">
          <select
            value={autoRefreshInterval}
            onChange={(event) => setAutoRefreshInterval(Number(event.target.value))}
            className="w-full rounded-full border border-white/10 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-100 outline-none transition focus:border-emerald-300/50"
          >
            <option value={5000}>Every 5 seconds</option>
            <option value={10000}>Every 10 seconds</option>
            <option value={30000}>Every 30 seconds</option>
            <option value={60000}>Every minute</option>
          </select>
        </div>
      )}
      {!autoRefreshEnabled && lastRefreshedAt && (
        <p className="mb-4 text-[11px] text-slate-500">
          Last refreshed: {Math.floor((Date.now() - lastRefreshedAt) / 1000)}s ago
        </p>
      )}

      <div className="space-y-4 overflow-y-auto pr-1">
        <FileTree />
        <FilePreview />
        <TaskList />
        <SessionInfo />
      </div>
    </aside>
  )
}
