import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Square,
  TerminalSquare,
} from 'lucide-react'
import type { WorkbenchTab } from '@/store/sessions'
import { useWorkspaceStore } from '@/store/workspace'

type PreviewState = 'starting' | 'running' | 'stopped' | 'error'

type PreviewStatus = {
  configurationId: string
  state: PreviewState
  url?: string
  port?: number
  logs: string[]
  error?: string
}

type PreviewConfiguration = {
  id: string
  name: string
  kind: 'script' | 'static'
  script?: string
  packageManager?: string
  framework: string
  port: number
  cwd: string
  status: PreviewStatus
}

type PreviewWebview = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  getURL: () => string
}

export function ProjectPreviewPage({ tab }: { tab: WorkbenchTab }) {
  const activeWorkspace = useWorkspaceStore((state) => state.cwd)
  const workspacePath = String(tab.payload?.workspacePath || tab.cwd || activeWorkspace)
  const webviewRef = useRef<PreviewWebview | null>(null)
  const [configurations, setConfigurations] = useState<PreviewConfiguration[]>([])
  const [configurationId, setConfigurationId] = useState('')
  const [status, setStatus] = useState<PreviewStatus | null>(null)
  const [browsers, setBrowsers] = useState<Array<{ id: string; name: string }>>([])
  const [browserId, setBrowserId] = useState('default')
  const [currentUrl, setCurrentUrl] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showLogs, setShowLogs] = useState(true)
  const [error, setError] = useState('')

  const selectedConfiguration = useMemo(
    () => configurations.find((item) => item.id === configurationId) ?? null,
    [configurationId, configurations],
  )

  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([
      window.hermesDesktop.listPreviewConfigurations(workspacePath),
      window.hermesDesktop.listInstalledBrowsers(),
    ]).then(([nextConfigurations, installedBrowsers]) => {
      if (cancelled) return
      setConfigurations(nextConfigurations)
      setBrowsers(installedBrowsers)
      const running = nextConfigurations.find((item) => item.status.state === 'running' || item.status.state === 'starting')
      const selected = running ?? nextConfigurations[0]
      setConfigurationId(selected?.id ?? '')
      setStatus(selected?.status ?? null)
      if (running?.status.url) {
        setCurrentUrl(running.status.url)
        setAddress(running.status.url)
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '读取预览配置失败。')
    })
    return () => { cancelled = true }
  }, [workspacePath])

  useEffect(() => {
    if (!configurationId) return
    let cancelled = false
    const poll = async () => {
      const result = await window.hermesDesktop.getPreviewServerStatus(workspacePath, configurationId)
      if (cancelled || !result.ok || !result.status) return
      setStatus(result.status)
      if (result.status.state === 'running' && result.status.url) {
        setCurrentUrl((current) => current || result.status!.url!)
        setAddress((current) => current || result.status!.url!)
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [configurationId, workspacePath])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const onStart = () => setLoading(true)
    const onStop = () => {
      setLoading(false)
      const nextUrl = webview.getURL?.()
      if (nextUrl) {
        setCurrentUrl(nextUrl)
        setAddress(nextUrl)
      }
    }
    const onFail = (event: Event) => {
      setLoading(false)
      const detail = event as Event & { errorDescription?: string; errorCode?: number }
      if (detail.errorCode !== -3) setError(detail.errorDescription ?? '页面加载失败。')
    }
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    webview.addEventListener('did-fail-load', onFail)
    return () => {
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
      webview.removeEventListener('did-fail-load', onFail)
    }
  }, [currentUrl])

  const selectConfiguration = (nextId: string) => {
    setConfigurationId(nextId)
    const next = configurations.find((item) => item.id === nextId)
    setStatus(next?.status ?? null)
    if (next?.status.url && next.status.state === 'running') {
      setCurrentUrl(next.status.url)
      setAddress(next.status.url)
    }
  }

  const startServer = async () => {
    if (!configurationId) return
    setBusy(true)
    setError('')
    try {
      const result = await window.hermesDesktop.startPreviewServer(workspacePath, configurationId)
      if (!result.ok || !result.status) throw new Error(result.error ?? '启动预览失败。')
      setStatus(result.status)
      if (result.status.url) setAddress(result.status.url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '启动预览失败。')
    } finally {
      setBusy(false)
    }
  }

  const stopServer = async () => {
    if (!configurationId) return
    setBusy(true)
    const result = await window.hermesDesktop.stopPreviewServer(workspacePath, configurationId)
    if (result.ok && result.status) setStatus(result.status)
    else setError(result.error ?? '停止预览失败。')
    setBusy(false)
  }

  const navigate = () => {
    const normalized = normalizeLocalAddress(address)
    if (!normalized) {
      setError('预览标签页仅允许访问 localhost 或 127.0.0.1。')
      return
    }
    setError('')
    setCurrentUrl(normalized)
    setAddress(normalized)
  }

  const openExternal = async () => {
    const normalized = normalizeLocalAddress(currentUrl || address)
    if (!normalized) {
      setError('没有可在浏览器中打开的本机预览地址。')
      return
    }
    const result = await window.hermesDesktop.openPreviewInBrowser(normalized, browserId)
    if (!result.ok) setError(result.error ?? '打开浏览器失败。')
  }

  const logs = status?.logs ?? []
  const serverActive = status?.state === 'starting' || status?.state === 'running'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950">
      <div className="flex min-w-0 items-center gap-2 border-b border-white/10 bg-slate-900/95 px-3 py-2">
        <div className="flex shrink-0 items-center gap-1">
          <IconButton title="后退" onClick={() => webviewRef.current?.canGoBack() && webviewRef.current.goBack()}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <IconButton title="前进" onClick={() => webviewRef.current?.canGoForward() && webviewRef.current.goForward()}>
            <ArrowRight className="h-4 w-4" />
          </IconButton>
          <IconButton title="刷新" onClick={() => webviewRef.current?.reload()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </IconButton>
        </div>

        <form
          className="flex min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            navigate()
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-slate-950 px-3 focus-within:border-cyan-300/40">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
              placeholder="http://127.0.0.1:5173"
              spellCheck={false}
            />
          </div>
        </form>

        <select
          value={browserId}
          onChange={(event) => setBrowserId(event.target.value)}
          className="h-8 max-w-[150px] rounded-md border border-white/10 bg-slate-950 px-2 text-xs text-slate-300 outline-none"
          title="选择外部浏览器"
        >
          {browsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.name}</option>)}
        </select>
        <IconButton title="在所选浏览器中打开" onClick={() => void openExternal()}>
          <ExternalLink className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 border-b border-white/10 bg-slate-900/70 px-3 py-2">
        <select
          value={configurationId}
          onChange={(event) => selectConfiguration(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950 px-2 text-xs text-slate-300 outline-none"
        >
          {configurations.length === 0 ? <option value="">未检测到预览脚本</option> : null}
          {configurations.map((configuration) => (
            <option key={configuration.id} value={configuration.id}>
              {configuration.name} · {configuration.framework} · :{configuration.port}
            </option>
          ))}
        </select>
        {serverActive ? (
          <button
            type="button"
            onClick={() => void stopServer()}
            disabled={busy}
            className="flex h-8 items-center gap-2 rounded-md border border-rose-300/25 bg-rose-300/10 px-3 text-xs text-rose-100 transition hover:bg-rose-300/15 disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" /> 停止
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startServer()}
            disabled={busy || !selectedConfiguration}
            className="flex h-8 items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs text-emerald-100 transition hover:bg-emerald-300/15 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} 启动
          </button>
        )}
        <span className="min-w-[64px] text-right text-xs text-slate-500">{stateLabel(status?.state)}</span>
      </div>

      {error || status?.error ? (
        <div className="border-b border-rose-300/20 bg-rose-300/8 px-4 py-2 text-xs text-rose-200">
          {error || status?.error}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 bg-white">
        {currentUrl ? (
          <webview
            ref={(element) => { webviewRef.current = element as PreviewWebview | null }}
            src={currentUrl}
            partition="persist:hermes-project-preview"
            className="h-full w-full"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-slate-950 text-slate-500">
            <div className="text-center">
              <Globe2 className="mx-auto h-8 w-8 text-slate-700" />
              <p className="mt-3 text-sm">{configurations.length ? '启动服务器以加载项目预览' : '输入本机开发服务器地址'}</p>
              <p className="mt-1 max-w-md break-all text-xs text-slate-600">{workspacePath}</p>
            </div>
          </div>
        )}
      </div>

      {configurationId ? (
        <div className="shrink-0 border-t border-white/10 bg-slate-950">
          <button
            type="button"
            onClick={() => setShowLogs((value) => !value)}
            className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-slate-400 transition hover:bg-white/5"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            服务器日志
            <span className="ml-auto">{showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</span>
          </button>
          {showLogs ? (
            <pre className="h-28 overflow-auto border-t border-white/8 px-3 py-2 font-mono text-[11px] leading-5 text-slate-400">
              {logs.length ? logs.join('\n') : '等待服务器输出...'}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-white/8 hover:text-slate-100"
    >
      {children}
    </button>
  )
}

function normalizeLocalAddress(value: string) {
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`
  try {
    const url = new URL(candidate)
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function stateLabel(state?: PreviewState) {
  if (state === 'starting') return '启动中'
  if (state === 'running') return '运行中'
  if (state === 'error') return '启动失败'
  return '已停止'
}
