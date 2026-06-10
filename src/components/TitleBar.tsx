import { useState, type CSSProperties } from 'react'
import { Bot, Minus, Moon, Pin, PinOff, RefreshCw, Sun, X } from 'lucide-react'
import { useDesktopWindowStore } from '@/store/window'
import { useThemeStore } from '@/store/theme'

export function TitleBar() {
  const alwaysOnTop = useDesktopWindowStore((state) => state.alwaysOnTop)
  const setWindowState = useDesktopWindowStore((state) => state.setState)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [reloading, setReloading] = useState(false)

  const handleToggleAlwaysOnTop = async () => {
    if (!window.hermesDesktop) {
      return
    }

    const nextState = await window.hermesDesktop.setAlwaysOnTop(!alwaysOnTop)
    setWindowState(nextState)
  }

  const handleHotReload = async () => {
    if (!window.hermesDesktop || reloading) return
    setReloading(true)
    try {
      await window.hermesDesktop.hotReload()
      // The backend reloads the window after rebuilding — no need to update stores.
    } catch {
      // Window may reload before the IPC resolves, which throws — ignore.
      setReloading(false)
    }
  }

  return (
    <header
      className="flex h-14 items-center justify-between border-b border-white/10 bg-slate-950/80 px-5 text-slate-100 backdrop-blur"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-400/20 text-cyan-200">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-200/80">Hermes</p>
          <p className="text-xs text-slate-400">桌面智能工作台</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-slate-400">
        <button
          type="button"
          onClick={() => void handleHotReload()}
          disabled={reloading}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition enabled:hover:border-emerald-300/40 enabled:hover:text-emerald-100 disabled:cursor-not-allowed disabled:text-slate-600"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          title="热重载 — 刷新模组与数据"
        >
          <RefreshCw className={`h-4 w-4 ${reloading ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => void handleToggleAlwaysOnTop()}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-cyan-300/40 hover:text-cyan-100"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          title={alwaysOnTop ? '取消置顶' : '置顶窗口'}
        >
          {alwaysOnTop ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-amber-300/40 hover:text-amber-100"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => void window.hermesDesktop?.minimizeWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-cyan-300/40 hover:text-cyan-100"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          title="最小化"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void window.hermesDesktop?.closeWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-rose-300/50 hover:bg-rose-400/10 hover:text-rose-100"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          title="关闭应用"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
