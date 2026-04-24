import { useState } from 'react'
import { Cable, Clipboard, ClipboardPaste, ExternalLink, FolderOpen, Terminal } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace'

export function SessionInfo() {
  const cwd = useWorkspaceStore((state) => state.cwd)
  const session = useWorkspaceStore((state) => state.session)
  const windows = useWorkspaceStore((state) => state.windows)
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const tasks = useWorkspaceStore((state) => state.tasks)
  const [status, setStatus] = useState<string | null>(null)

  const handleRevealWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('桌面桥接不可用。')
      return
    }

    const result = await window.hermesDesktop.revealWorkspaceInWindows()
    setStatus(result.ok ? `已在资源管理器中打开：${result.windowsPath}` : result.error ?? '打开资源管理器失败。')
  }

  const handleOpenWorkspace = async () => {
    if (!window.hermesDesktop) {
      setStatus('桌面桥接不可用。')
      return
    }

    const result = await window.hermesDesktop.openWorkspaceInWindows()
    setStatus(result.ok ? `已用默认程序打开：${result.windowsPath}` : result.error ?? '打开工作区失败。')
  }

  const handleReadClipboard = async () => {
    if (!window.hermesDesktop) {
      setStatus('桌面桥接不可用。')
      return
    }

    const result = await window.hermesDesktop.readWindowsClipboard()
    if (!result.ok) {
      setStatus(result.error ?? '读取剪贴板失败。')
      return
    }

    const text = result.text ?? ''
    setSnapshot({
      cwd,
      session,
      tasks,
      windows: {
        ...windows,
        clipboardPreview: text,
      },
    })
    setStatus('已读取 Windows 剪贴板内容。')
  }

  const handleCopyWindowsPath = async () => {
    if (!window.hermesDesktop) {
      setStatus('桌面桥接不可用。')
      return
    }

    if (!windows.windowsPath) {
      setStatus('当前没有可用的 Windows 路径。')
      return
    }

    const result = await window.hermesDesktop.writeWindowsClipboard(windows.windowsPath)
    setStatus(result.ok ? '已复制 Windows 路径到剪贴板。' : result.error ?? '写入剪贴板失败。')
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
      <div className="mb-4 flex items-center gap-2 font-semibold text-white">
        <Cable className="h-4 w-4 text-cyan-200" />
        会话信息
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">ID</p>
          <p className="mt-1">{session}</p>
        </div>
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-500">
            <Terminal className="h-3 w-3" /> 工作目录
          </div>
          <p className="break-all text-xs leading-5">{cwd}</p>
        </div>
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Windows 路径</p>
          <p className="mt-2 break-all text-xs leading-5 text-slate-200">
            {windows.windowsPath ?? '当前环境暂不可用 Windows 互操作'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRevealWorkspace()}
              disabled={!windows.available}
              className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100 transition enabled:hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在资源管理器中定位
            </button>
            <button
              type="button"
              onClick={() => void handleOpenWorkspace()}
              disabled={!windows.available}
              className="flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition enabled:hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              用默认程序打开
            </button>
            <button
              type="button"
              onClick={() => void handleCopyWindowsPath()}
              disabled={!windows.available || !windows.windowsPath}
              className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <Clipboard className="h-3.5 w-3.5" />
              复制路径
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Windows 剪贴板</p>
            <button
              type="button"
              onClick={() => void handleReadClipboard()}
              disabled={!windows.available}
              className="flex items-center gap-1 rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] text-fuchsia-100 transition enabled:hover:bg-fuchsia-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              从 Windows 读取
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-all text-xs leading-5 text-slate-200">
            {windows.clipboardPreview || '尚未读取任何剪贴板内容。'}
          </p>
          {status ? <p className="mt-2 text-[11px] leading-5 text-slate-400">{status}</p> : null}
        </div>
      </div>
    </section>
  )
}
