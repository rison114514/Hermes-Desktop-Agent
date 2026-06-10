import { useEffect, useState } from 'react'
import { ChevronDown, Globe, RotateCw, Search } from 'lucide-react'
import { useProxyStore } from '@/store/proxy'

export function ProxyConfig() {
  const enabled = useProxyStore((state) => state.enabled)
  const type = useProxyStore((state) => state.type)
  const host = useProxyStore((state) => state.host)
  const port = useProxyStore((state) => state.port)
  const setEnabled = useProxyStore((state) => state.setEnabled)
  const setType = useProxyStore((state) => state.setType)
  const setHost = useProxyStore((state) => state.setHost)
  const setPort = useProxyStore((state) => state.setPort)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!window.hermesDesktop?.setProxyConfig) return
    const { enabled, type, host, port } = useProxyStore.getState()
    window.hermesDesktop.setProxyConfig({ enabled, type, host, port }).catch(() => { /* noop */ })
  }, [])

  const [detecting, setDetecting] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const handleDetect = async () => {
    if (!window.hermesDesktop?.detectProxyHost) return
    setDetecting(true)
    try {
      const result = await window.hermesDesktop.detectProxyHost()
      if (result.host) setHost(result.host)
    } finally {
      setDetecting(false)
    }
  }

  const handleRestart = async () => {
    if (!window.hermesDesktop?.restartBackend) return
    setRestarting(true)
    try {
      await window.hermesDesktop.restartBackend()
    } finally {
      setRestarting(false)
    }
  }

  const summary = enabled
    ? `${type === 'socks5' ? 'SOCKS5' : 'HTTP'} · ${host}:${port}`
    : '已禁用'

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <p className="truncate text-[11px] text-slate-500">{open ? '' : summary}</p>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">状态</p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setEnabled(true)}
                className={`rounded-full px-3 py-1 text-[11px] transition ${
                  enabled
                    ? 'border border-emerald-300/30 bg-emerald-300/15 text-emerald-100'
                    : 'border border-white/10 bg-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                启用
              </button>
              <button
                type="button"
                onClick={() => setEnabled(false)}
                className={`rounded-full px-3 py-1 text-[11px] transition ${
                  !enabled
                    ? 'border border-rose-300/30 bg-rose-300/15 text-rose-100'
                    : 'border border-white/10 bg-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                禁用
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">类型</p>
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => setType('http')}
                className={`rounded-full px-3 py-1 text-[11px] transition ${
                  type === 'http'
                    ? 'border border-cyan-300/30 bg-cyan-300/15 text-cyan-100'
                    : 'border border-white/10 bg-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                HTTP
              </button>
              <button
                type="button"
                onClick={() => setType('socks5')}
                className={`rounded-full px-3 py-1 text-[11px] transition ${
                  type === 'socks5'
                    ? 'border border-cyan-300/30 bg-cyan-300/15 text-cyan-100'
                    : 'border border-white/10 bg-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                SOCKS5
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Host</p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="127.0.0.1"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50"
              />
              <button
                type="button"
                onClick={() => void handleDetect()}
                disabled={detecting}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100 transition enabled:hover:bg-emerald-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              >
                <Search className="h-3 w-3" />
                {detecting ? '...' : '检测'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Port</p>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 0)}
              placeholder="7890"
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleRestart()}
            disabled={restarting}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 transition enabled:hover:bg-amber-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          >
            <RotateCw className={`h-3.5 w-3.5 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? '重启中...' : '重启后端使代理生效'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
