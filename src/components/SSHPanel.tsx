import { useEffect, useState } from 'react'
import { ChevronDown, Folder, File, RefreshCw, Terminal, Upload, Download, Plug, PlugZap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServerInfo {
  host: string
  port: number
  username: string
  name: string
  connected: boolean
}

interface FileEntry {
  name: string
  size: number
  isDir: boolean
  mode: number
  mtime: number
}

export function SSHPanel() {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [selectedHost, setSelectedHost] = useState('')
  const [selectedPort, setSelectedPort] = useState(22)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => { refreshStatus() }, [])

  const refreshStatus = async () => {
    setLoading(true)
    try {
      const result = await callMod('status')
      if (Array.isArray(result)) {
        setServers(result)
        const conn = result.find((s: ServerInfo) => s.connected)
        if (conn) {
          setSelectedHost(conn.host)
          setSelectedPort(conn.port)
          if (!currentPath || currentPath === '/') listFiles(conn.host, conn.port, '/')
        }
      }
    } finally { setLoading(false) }
  }

  const callMod = async (method: string, args?: Record<string, unknown>) => {
    if (!window.hermesDesktop?.callModIpc) return null
    return window.hermesDesktop.callModIpc('hermes-ssh', method, args)
  }

  const handleConnect = async (host: string, port: number, username: string) => {
    setStatusText('连接中...')
    setLoading(true)
    const result = await callMod('connect', { host, port, username, password: '' })
    if (result?.ok) {
      setSelectedHost(host)
      setSelectedPort(port)
      setStatusText('已连接')
      listFiles(host, port, '/')
    } else {
      setStatusText(result?.error || '连接失败')
    }
    setLoading(false)
  }

  const handleDisconnect = async (host: string, port: number) => {
    setLoading(true)
    await callMod('disconnect', { host, port })
    setFiles([])
    setStatusText('已断开')
    setLoading(false)
  }

  const listFiles = async (host: string, port: number, path: string) => {
    setLoading(true)
    const result = await callMod('list-files', { host, port, path })
    if (result?.ok) {
      setFiles(result.files)
      setCurrentPath(result.path)
      setStatusText('')
    } else {
      setStatusText(result?.error || '读取目录失败')
    }
    setLoading(false)
  }

  const handleDownload = async (remotePath: string, fileName: string) => {
    setLoading(true)
    const result = await callMod('read-file', { host: selectedHost, port: selectedPort, path: remotePath })
    if (result?.ok) {
      if (window.hermesDesktop?.writeWindowsClipboard) {
        await window.hermesDesktop.writeWindowsClipboard(result.content)
        setStatusText(`已复制 ${fileName} 内容到剪贴板 (${result.size} 字节${result.truncated ? ', 已截断' : ''})`)
      }
    } else {
      setStatusText(result?.error || '读取失败')
    }
    setLoading(false)
  }

  const handleUpload = async (targetDir: string) => {
    const clipResult = await window.hermesDesktop?.readWindowsClipboard()
    if (!clipResult?.ok || !clipResult.text) {
      setStatusText('剪贴板为空，请先复制要上传的内容')
      return
    }
    const fileName = prompt('文件名:', 'uploaded.txt')
    if (!fileName) return
    const remotePath = targetDir === '/' ? `/${fileName}` : `${targetDir}/${fileName}`
    setLoading(true)
    const result = await callMod('write-file', { host: selectedHost, port: selectedPort, path: remotePath, content: clipResult.text })
    if (result?.ok) {
      setStatusText(`已上传: ${fileName}`)
      listFiles(selectedHost, selectedPort, targetDir)
    } else {
      setStatusText(result?.error || '上传失败')
    }
    setLoading(false)
  }

  const navigateDir = (dirName: string) => {
    const newPath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`
    listFiles(selectedHost, selectedPort, newPath)
  }

  const navigateUp = () => {
    if (currentPath === '/') return
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    listFiles(selectedHost, selectedPort, parent)
  }

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-sky-200" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">SSH</p>
            {!open && servers.some(s => s.connected) ? (
              <p className="mt-0.5 truncate text-[11px] text-emerald-100/80">
                {servers.filter(s => s.connected).length} 台已连接
              </p>
            ) : null}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          {/* Server list */}
          <div className="space-y-2">
            {servers.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-500">未配置服务器。在对话中告诉 Agent 连接服务器。</p>
            ) : (
              servers.map((s) => (
                <div
                  key={`${s.host}:${s.port}`}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-2xl border px-4 py-3',
                    s.connected ? 'border-emerald-300/20 bg-emerald-400/8' : 'border-white/10 bg-slate-950/80',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {s.connected ? <PlugZap className="h-3 w-3 text-emerald-200" /> : <Plug className="h-3 w-3 text-slate-500" />}
                      <p className="truncate text-xs font-medium text-slate-100">{s.name || s.host}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{s.username}@{s.host}:{s.port}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => s.connected ? void handleDisconnect(s.host, s.port) : void handleConnect(s.host, s.port, s.username)}
                    disabled={loading}
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-[11px] transition',
                      s.connected
                        ? 'border border-rose-300/20 bg-transparent text-slate-400 hover:text-rose-200'
                        : 'border border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/18',
                      loading && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    {s.connected ? '断开' : '连接'}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* File browser — only when a server is connected */}
          {servers.some(s => s.connected) ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={navigateUp}
                  disabled={currentPath === '/'}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Folder className="h-3 w-3" />
                  上级
                </button>
                <p className="truncate text-[11px] text-slate-400">{currentPath}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleUpload(currentPath)}
                    disabled={loading}
                    className="flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="h-3 w-3" />
                    上传
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshStatus()}
                    disabled={loading}
                    className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10"
                  >
                    <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* File list */}
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {files.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 transition hover:bg-white/5"
                  >
                    <button
                      type="button"
                      onClick={() => f.isDir ? navigateDir(f.name) : void handleDownload(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`, f.name)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {f.isDir ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-amber-200" />
                      ) : (
                        <File className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="truncate text-xs text-slate-200">{f.name}</span>
                    </button>
                    <span className="shrink-0 text-[10px] text-slate-600">
                      {f.isDir ? '目录' : formatSize(f.size)}
                    </span>
                  </div>
                ))}
                {files.length === 0 && !loading ? (
                  <p className="py-4 text-center text-[11px] text-slate-500">空目录</p>
                ) : null}
              </div>
            </>
          ) : null}

          {/* Status */}
          {statusText ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
              <p className="text-[11px] text-slate-400">{statusText}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
