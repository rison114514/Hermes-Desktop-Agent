import { useEffect, useState } from 'react'
import {
  ChevronDown, Folder, File, RefreshCw, Terminal, Upload,
  Plug, PlugZap, Plus, Trash2, Settings, X, Key, Eye, EyeOff, Activity, ExternalLink
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModsStore } from '@/store/mods'
import { useSessionStore } from '@/store/sessions'

interface ServerConfig {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
}

interface ServerInfo {
  host: string; port: number; username: string; name: string; connected: boolean
}

interface FileEntry {
  name: string; size: number; isDir: boolean; mode: number; mtime: number
}

export function SSHPanel({ variant = 'card' }: { variant?: 'card' | 'page' }) {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [configs, setConfigs] = useState<ServerConfig[]>([])
  const [activeHost, setActiveHost] = useState('')
  const [activePort, setActivePort] = useState(22)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [currentPath, setCurrentPath] = useState('/')
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [open, setOpen] = useState(variant === 'page')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)

  // Add form state
  const [form, setForm] = useState<ServerConfig>({
    name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', keyPath: ''
  })

  // Re-fetch on mount and whenever the backend signals MODs are ready, so saved
  // server configs/status load even if this panel mounted before the mod IPC
  // handlers were registered.
  const modsReadyNonce = useModsStore((s) => s.modsReadyNonce)
  const openTab = useSessionStore((s) => s.openTab)
  useEffect(() => { refreshStatus() }, [modsReadyNonce])

  const callMod = async (method: string, args?: Record<string, unknown>) => {
    if (!window.hermesDesktop?.callModIpc) return null
    return window.hermesDesktop.callModIpc('hermes-ssh', method, args)
  }

  const refreshStatus = async () => {
    setLoading(true)
    try {
      const result = await callMod('status')
      if (Array.isArray(result)) {
        setServers(result)
        const conn = result.find((s: ServerInfo) => s.connected)
        if (conn && (!activeHost || activeHost === conn.host)) {
          setActiveHost(conn.host)
          setActivePort(conn.port)
          if (!currentPath || currentPath === '/') listFiles(conn.host, conn.port, '/')
        }
      }
    } finally { setLoading(false) }
  }

  const loadConfigs = async () => {
    const r = await callMod('get-configs')
    if (Array.isArray(r)) setConfigs(r)
  }

  useEffect(() => { if (open) { void loadConfigs() } }, [open])

  const handleConnect = async (cfg: ServerConfig) => {
    setStatusText(`连接 ${cfg.name || cfg.host}...`)
    setLoading(true)
    const auth: Record<string, string> = {}
    if (cfg.authType === 'password') auth.password = cfg.password || ''
    else auth.privateKey = cfg.keyPath || ''
    const result = await callMod('connect', {
      host: cfg.host, port: cfg.port, username: cfg.username, password: auth.password, privateKey: auth.privateKey,
    })
    if (result?.ok) {
      setActiveHost(cfg.host)
      setActivePort(cfg.port)
      setStatusText('已连接')
      listFiles(cfg.host, cfg.port, '/')
    } else {
      setStatusText(result?.error || '连接失败')
    }
    setLoading(false)
  }

  const testConnectivity = async (cfg: ServerConfig) => {
    setStatusText(`测试 ${cfg.name || cfg.host} ...`)
    setLoading(true)
    const alreadyConnected = servers.some(s => s.host === cfg.host && s.port === cfg.port && s.connected)
    const auth: Record<string, string> = {}
    if (cfg.authType === 'password') auth.password = cfg.password || ''
    else auth.privateKey = cfg.keyPath || ''
    const result = await callMod('connect', {
      host: cfg.host, port: cfg.port, username: cfg.username, password: auth.password, privateKey: auth.privateKey,
    })
    if (result?.ok) {
      setStatusText(`✓ ${cfg.name || cfg.host} 连接成功`)
      // Only tear down the connection we opened for this test; leave any
      // pre-existing connection to this host intact.
      if (!alreadyConnected) await callMod('disconnect', { host: cfg.host, port: cfg.port })
    } else {
      setStatusText(`✗ ${cfg.name || cfg.host} 连接失败: ${result?.error || '未知错误'}`)
    }
    setLoading(false)
    void refreshStatus()
  }

  const handleDisconnect = async (host: string, port: number) => {
    setLoading(true)
    await callMod('disconnect', { host, port })
    setFiles([])
    setActiveHost('')
    setStatusText('已断开')
    setLoading(false)
    refreshStatus()
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
    const result = await callMod('read-file', { host: activeHost, port: activePort, path: remotePath })
    if (result?.ok) {
      if (window.hermesDesktop?.writeWindowsClipboard) {
        await window.hermesDesktop.writeWindowsClipboard(result.content)
        setStatusText(`已复制 ${fileName} 到剪贴板 (${result.size} 字节${result.truncated ? ', 已截断' : ''})`)
      }
    } else setStatusText(result?.error || '读取失败')
    setLoading(false)
  }

  const handleUpload = async (targetDir: string) => {
    const clip = await window.hermesDesktop?.readWindowsClipboard()
    if (!clip?.ok || !clip.text) { setStatusText('剪贴板为空'); return }
    const fileName = prompt('文件名:', 'uploaded.txt')
    if (!fileName) return
    const remotePath = targetDir === '/' ? `/${fileName}` : `${targetDir}/${fileName}`
    setLoading(true)
    const result = await callMod('write-file', { host: activeHost, port: activePort, path: remotePath, content: clip.text })
    if (result?.ok) { setStatusText(`已上传: ${fileName}`); listFiles(activeHost, activePort, targetDir) }
    else setStatusText(result?.error || '上传失败')
    setLoading(false)
  }

  const navigateDir = (dirName: string) => {
    const np = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`
    listFiles(activeHost, activePort, np)
  }

  const navigateUp = () => {
    if (currentPath === '/') return
    listFiles(activeHost, activePort, currentPath.split('/').slice(0, -1).join('/') || '/')
  }

  const saveConfig = async () => {
    if (!form.host || !form.username) { setStatusText('Host 和 Username 必填'); return }
    const r = await callMod('add-server', { server: { ...form, name: form.name || form.host } })
    if (r?.ok) { setShowAddForm(false); setEditingServer(null); setForm({ name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', keyPath: '' }); void loadConfigs() }
    else setStatusText(r?.error || '保存失败')
  }

  const removeConfig = async (host: string, port: number) => {
    await callMod('remove-server', { host, port })
    void loadConfigs()
  }

  const editConfig = (cfg: ServerConfig) => {
    setForm(cfg)
    setEditingServer(cfg.host)
    setShowAddForm(true)
  }

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  const connectedServer = servers.find(s => s.connected && s.host === activeHost)
  const expanded = variant === 'page' || open

  const openSshTab = () => {
    openTab({
      id: 'mod:hermes-ssh:ssh-manager',
      kind: 'mod',
      modName: 'hermes-ssh',
      rendererType: 'ssh-manager',
      name: 'SSH 管理',
      closable: true,
    })
  }

  return (
    <div className={cn(
      'border border-white/10 bg-white/5 p-4',
      variant === 'page' ? 'm-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl' : 'rounded-[28px]',
    )}>
      <div className="flex w-full items-center justify-between gap-3 text-left">
        <button type="button" onClick={() => variant === 'card' && setOpen(v => !v)} aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-sky-200" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">SSH</p>
            {!expanded && (
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {connectedServer ? `${connectedServer.name} · 已连接` : configs.length > 0 ? `${configs.length} 台主机` : '未配置'}
              </p>
            )}
          </div>
        </div>
        {variant === 'card' ? <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} /> : null}
        </button>
        {variant === 'card' ? (
          <button
            type="button"
            onClick={openSshTab}
            className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-slate-500 transition hover:text-sky-200"
            title="在标签页打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className={cn('mt-4 space-y-3', variant === 'page' && 'min-h-0 flex-1 overflow-y-auto pr-1')}>
          {/* Server list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-500">{configs.length > 0 ? `${configs.length} 台主机` : '未配置主机'}</p>
              <button type="button" onClick={() => { setEditingServer(null); setForm({ name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', keyPath: '' }); setShowAddForm(v => !v) }}
                className="flex items-center gap-1 rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 text-[11px] text-sky-100 transition hover:bg-sky-300/18">
                <Plus className="h-3 w-3" /> 添加
              </button>
            </div>

            {/* Add/Edit form */}
            {showAddForm ? (
              <div className="rounded-2xl border border-sky-300/20 bg-slate-950/80 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-sky-200/70">
                    {editingServer ? '编辑主机' : '添加主机'}
                  </p>
                  <button type="button" onClick={() => setShowAddForm(false)}
                    className="grid h-5 w-5 place-items-center rounded-full border border-white/10 text-slate-500 hover:text-slate-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="显示名称 (可选)" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-300/50" />
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <input type="text" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                    placeholder="主机地址 *" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-300/50" />
                  <input type="number" value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) || 22 })}
                    placeholder="22" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-300/50" />
                </div>
                <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="用户名 *" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-300/50" />

                {/* Auth type switch */}
                <div className="flex gap-1">
                  <button type="button" onClick={() => setForm({ ...form, authType: 'password' })}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] transition',
                      form.authType === 'password' ? 'border border-sky-300/30 bg-sky-300/15 text-sky-100' : 'border border-white/10 text-slate-500 hover:text-slate-300')}>
                    密码
                  </button>
                  <button type="button" onClick={() => setForm({ ...form, authType: 'key' })}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] transition',
                      form.authType === 'key' ? 'border border-sky-300/30 bg-sky-300/15 text-sky-100' : 'border border-white/10 text-slate-500 hover:text-slate-300')}>
                    <Key className="h-3 w-3 inline mr-1" />密钥
                  </button>
                </div>

                {form.authType === 'password' ? (
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={form.password || ''}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="密码" className="w-full rounded-xl border border-white/10 bg-slate-900 py-1.5 pl-3 pr-8 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-300/50" />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ) : (
                  <input type="text" value={form.keyPath || ''} onChange={e => setForm({ ...form, keyPath: e.target.value })}
                    placeholder="密钥文件路径 (如 ~/.ssh/id_rsa)" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-300/50" />
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={saveConfig} disabled={loading}
                    className="flex-1 rounded-xl border border-emerald-300/25 bg-emerald-300/10 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/18 disabled:opacity-50">
                    {editingServer ? '保存修改' : '添加'}
                  </button>
                  <button type="button" onClick={() => setShowAddForm(false)}
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 py-1.5 text-xs text-slate-400 transition hover:bg-white/10">
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {/* Config list */}
            {configs.map(cfg => {
              const key = `${cfg.host}:${cfg.port}`
              const isConnected = servers.some(s => s.host === cfg.host && s.port === cfg.port && s.connected)
              const isActive = activeHost === cfg.host && activePort === cfg.port && isConnected
              return (
                <div key={key} className={cn('rounded-2xl border px-3 py-2.5 transition',
                  isActive ? 'border-emerald-300/30 bg-emerald-400/10' : isConnected ? 'border-sky-300/20 bg-sky-400/5' : 'border-white/10 bg-slate-950/80')}>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => isConnected ? isActive ? handleDisconnect(cfg.host, cfg.port) : (setActiveHost(cfg.host), setActivePort(cfg.port), listFiles(cfg.host, cfg.port, '/')) : handleConnect(cfg)}
                      disabled={loading} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {isConnected ? <PlugZap className="h-3 w-3 shrink-0 text-emerald-200" /> : <Plug className="h-3 w-3 shrink-0 text-slate-500" />}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-100">{cfg.name || cfg.host}</p>
                        <p className="truncate text-[10px] text-slate-500">{cfg.username}@{cfg.host}:{cfg.port}</p>
                      </div>
                    </button>
                    <div className="flex shrink-0 gap-0.5">
                      <button type="button" onClick={() => void testConnectivity(cfg)} disabled={loading}
                        title="测试连通性"
                        className="grid h-6 w-6 place-items-center rounded-full border border-white/10 text-slate-500 transition hover:text-emerald-300 disabled:opacity-50">
                        <Activity className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => editConfig(cfg)}
                        className="grid h-6 w-6 place-items-center rounded-full border border-white/10 text-slate-500 hover:text-slate-300">
                        <Settings className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => removeConfig(cfg.host, cfg.port)}
                        className="grid h-6 w-6 place-items-center rounded-full border border-white/10 text-slate-500 hover:text-rose-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* File browser */}
          {connectedServer ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={navigateUp} disabled={currentPath === '/'}
                  className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/10 disabled:opacity-40">
                  <Folder className="h-3 w-3" /> 上级
                </button>
                <p className="truncate text-[11px] text-slate-400">{currentPath}</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => void handleUpload(currentPath)} disabled={loading}
                    className="flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-300/18 disabled:opacity-50">
                    <Upload className="h-3 w-3" /> 上传
                  </button>
                  <button type="button" onClick={() => void refreshStatus()} disabled={loading}
                    className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10">
                    <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {files.map(f => (
                  <div key={f.name} className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 transition hover:bg-white/5">
                    <button type="button"
                      onClick={() => f.isDir ? navigateDir(f.name) : void handleDownload(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`, f.name)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {f.isDir ? <Folder className="h-3.5 w-3.5 shrink-0 text-amber-200" /> : <File className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                      <span className="truncate text-xs text-slate-200">{f.name}</span>
                    </button>
                    <span className="shrink-0 text-[10px] text-slate-600">{f.isDir ? '目录' : formatSize(f.size)}</span>
                  </div>
                ))}
                {files.length === 0 && !loading ? <p className="py-4 text-center text-[11px] text-slate-500">空目录</p> : null}
              </div>
            </>
          ) : null}

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
