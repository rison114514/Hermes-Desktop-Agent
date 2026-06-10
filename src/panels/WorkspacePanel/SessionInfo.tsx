import { useEffect, useMemo, useState } from 'react'
import {
  Cable,
  Clipboard,
  ClipboardPaste,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace'
import { CollapsibleSection } from './CollapsibleSection'

type HermesWorktreeInfo = {
  path: string
  branch: string
  head: string
  detached: boolean
  current: boolean
  name: string
}

export function SessionInfo() {
  const cwd = useWorkspaceStore((state) => state.cwd)
  const windows = useWorkspaceStore((state) => state.windows)
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const tasks = useWorkspaceStore((state) => state.tasks)
  const files = useWorkspaceStore((state) => state.files)
  const [status, setStatus] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<HermesWorktreeInfo[]>([])
  const [selectedWorktreePath, setSelectedWorktreePath] = useState('')
  const [newWorktreeName, setNewWorktreeName] = useState('')
  const [newWorktreeDirectory, setNewWorktreeDirectory] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)

  const isNativeBackend = windows.distro === 'native'
  const isWslBackend = windows.distro && windows.distro !== 'native'

  const selectedWorktree = useMemo(
    () => worktrees.find((item) => item.path === selectedWorktreePath) ?? null,
    [selectedWorktreePath, worktrees],
  )

  const refreshWorktrees = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    setSessionLoading(true)
    try {
      const list = await window.hermesDesktop.listHermesWorktrees()
      setWorktrees(list)
      setSelectedWorktreePath((current) => {
        if (current && list.some((item) => item.path === current)) {
          return current
        }
        return list.find((item) => item.current)?.path ?? list[0]?.path ?? ''
      })
      setStatus(list.length ? `Loaded ${list.length} git worktrees.` : 'No git worktrees found.')
    } catch (error) {
      setWorktrees([])
      setSelectedWorktreePath('')
      setStatus(error instanceof Error ? error.message : 'Failed to load worktrees.')
    } finally {
      setSessionLoading(false)
    }
  }

  // Re-list worktrees whenever the workspace directory changes — including when
  // switching sessions, since each tab can point at a different cwd. The cwd in
  // the store is updated by switchSession's snapshot after the backend has
  // already repointed workspaceRoot, so the listing reflects the active session.
  useEffect(() => {
    void refreshWorktrees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const handleCreateWorktree = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    setSessionLoading(true)
    try {
      const result = await window.hermesDesktop.createHermesWorktree({
        name: newWorktreeName,
        directory: newWorktreeDirectory,
      })
      setSnapshot(result.snapshot)
      setNewWorktreeName('')
      setNewWorktreeDirectory('')
      await refreshWorktrees()
      setSelectedWorktreePath(result.worktree.path)
      setStatus(`Created worktree ${result.worktree.name} on ${result.worktree.branch} (session preserved).`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create worktree.')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleSelectWorktreeDirectory = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    try {
      const result = await window.hermesDesktop.selectWorktreeDirectory()
      if (!result.canceled && result.path) {
        setNewWorktreeDirectory(result.path)
        setStatus(`Selected worktree directory: ${result.path}`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to select directory.')
    }
  }

  const handleSwitchWorktree = async () => {
    if (!window.hermesDesktop || !selectedWorktree) {
      return
    }

    setSessionLoading(true)
    try {
      const snapshot = await window.hermesDesktop.softSwitchWorkspace(selectedWorktree.path)
      setSnapshot(snapshot)
      await refreshWorktrees()
      setStatus(`Switched to ${selectedWorktree.name} (session preserved).`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to switch worktree.')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleSwitchWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    setSessionLoading(true)
    try {
      const selected = await window.hermesDesktop.selectWorkspaceDirectory()
      if (selected.canceled || !selected.path) {
        return
      }

      const snapshot = await window.hermesDesktop.softSwitchWorkspace(selected.path)
      setSnapshot(snapshot)
      await refreshWorktrees()
      setStatus(`Switched workspace to ${snapshot.cwd} (session preserved).`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to switch workspace.')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleRefreshWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    setSessionLoading(true)
    try {
      const snapshot = await window.hermesDesktop.getWorkspaceSnapshot()
      setSnapshot(snapshot)
      setStatus(`Refreshed workspace ${snapshot.cwd}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to refresh workspace.')
    } finally {
      setSessionLoading(false)
    }
  }

  const handleRevealWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    const result = await window.hermesDesktop.revealWorkspaceInWindows()
    setStatus(result.ok ? `Revealed in Explorer: ${result.windowsPath}` : result.error ?? 'Failed to reveal workspace.')
  }

  const handleOpenWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    const result = await window.hermesDesktop.openWorkspaceInWindows()
    setStatus(result.ok ? `Opened: ${result.windowsPath}` : result.error ?? 'Failed to open workspace.')
  }

  const handleReadClipboard = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    const result = await window.hermesDesktop.readWindowsClipboard()
    if (!result.ok) {
      setStatus(result.error ?? 'Failed to read clipboard.')
      return
    }

    setSnapshot({
      cwd,
      session: useWorkspaceStore.getState().session,
      files,
      tasks,
      windows: {
        ...windows,
        clipboardPreview: result.text ?? '',
      },
    })
    setStatus('Read Windows clipboard.')
  }

  const handleCopyWindowsPath = async () => {
    if (!window.hermesDesktop) {
      setStatus('Desktop bridge is unavailable.')
      return
    }

    if (!windows.windowsPath) {
      setStatus('No Windows path is available for this workspace.')
      return
    }

    const result = await window.hermesDesktop.writeWindowsClipboard(windows.windowsPath)
    setStatus(result.ok ? 'Copied Windows path.' : result.error ?? 'Failed to write clipboard.')
  }

  return (
    <CollapsibleSection
      title="Workspace"
      icon={<Cable className="h-4 w-4 text-cyan-200" />}
      className="text-sm text-slate-300"
    >

      <div className="space-y-3">
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500">
              <Terminal className="h-3 w-3" /> Workspace
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRefreshWorkspace()}
                disabled={sessionLoading}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
                title="Refresh workspace"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${sessionLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => void handleSwitchWorkspace()}
                disabled={sessionLoading}
                className="flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-[11px] text-cyan-100 transition enabled:hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Change
              </button>
            </div>
          </div>
          <p className="break-all text-xs leading-5">{cwd}</p>
        </div>

        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Worktree</p>
            <button
              type="button"
              onClick={() => void refreshWorktrees()}
              disabled={sessionLoading}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600"
              title="Refresh worktrees"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${sessionLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <select
            value={selectedWorktreePath}
            onChange={(event) => setSelectedWorktreePath(event.target.value)}
            disabled={sessionLoading || worktrees.length === 0}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {worktrees.length === 0 ? (
              <option value="">No worktrees</option>
            ) : worktrees.map((item) => (
              <option key={item.path} value={item.path}>
                {item.current ? '* ' : ''}{item.name} - {item.branch || item.head.slice(0, 8)}
              </option>
            ))}
          </select>

          {selectedWorktree ? (
            <p className="mt-2 break-all text-[11px] leading-5 text-slate-500">
              {selectedWorktree.branch || selectedWorktree.head.slice(0, 8)} · {selectedWorktree.path}
            </p>
          ) : null}

          <div className="mt-3 grid gap-2">
            <input
              type="text"
              value={newWorktreeName}
              onChange={(event) => setNewWorktreeName(event.target.value)}
              disabled={sessionLoading}
              placeholder="New worktree name"
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
            />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                type="text"
                value={newWorktreeDirectory}
                readOnly
                disabled={sessionLoading}
                placeholder="Target directory, optional"
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 disabled:cursor-not-allowed disabled:text-slate-500"
              />
              <button
                type="button"
                onClick={() => void handleSelectWorktreeDirectory()}
                disabled={sessionLoading}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleSwitchWorktree()}
              disabled={sessionLoading || !selectedWorktree}
              className="flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100 transition enabled:hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <Terminal className="h-3.5 w-3.5" />
              Switch
            </button>
            <button
              type="button"
              onClick={() => void handleCreateWorktree()}
              disabled={sessionLoading}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <FolderGit2 className="h-3.5 w-3.5" />
              New
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Runtime</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs leading-5">
            <div>
              <p className="text-slate-500">Host</p>
              <p className="text-slate-200">{windows.hostPlatform ?? 'win32'}</p>
            </div>
            <div>
              <p className="text-slate-500">Backend</p>
              <p className="text-slate-200">{isNativeBackend ? 'Native' : windows.distro ?? 'Auto'}</p>
            </div>
          </div>
          <p className="mt-2 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2 py-1 text-[11px] text-cyan-100">
            {windows.workspaceMode ?? 'windows-workspace'}
          </p>
        </div>

        {isWslBackend && (
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">WSL Path</p>
          <p className="mt-2 break-all text-xs leading-5 text-slate-200">{windows.wslPath}</p>
        </div>
        )}

        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Windows Path</p>
          <p className="mt-2 break-all text-xs leading-5 text-slate-200">
            {windows.windowsPath ?? 'No Windows path available.'}
          </p>
          {windows.uncPath ? (
            <p className="mt-2 break-all text-[11px] leading-5 text-slate-500">UNC: {windows.uncPath}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRevealWorkspace()}
              disabled={!windows.available}
              className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100 transition enabled:hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Reveal
            </button>
            <button
              type="button"
              onClick={() => void handleOpenWorkspace()}
              disabled={!windows.available}
              className="flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition enabled:hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open
            </button>
            <button
              type="button"
              onClick={() => void handleCopyWindowsPath()}
              disabled={!windows.available || !windows.windowsPath}
              className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <Clipboard className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Clipboard</p>
            <button
              type="button"
              onClick={() => void handleReadClipboard()}
              disabled={!windows.available}
              className="flex items-center gap-1 rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] text-fuchsia-100 transition enabled:hover:bg-fuchsia-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Read
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-all text-xs leading-5 text-slate-200">
            {windows.clipboardPreview || 'Clipboard not read yet.'}
          </p>
          {status ? <p className="mt-2 text-[11px] leading-5 text-slate-400">{status}</p> : null}
        </div>
      </div>
    </CollapsibleSection>
  )
}
