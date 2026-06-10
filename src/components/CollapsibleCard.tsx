import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleCardProps {
  id: string
  icon: ReactNode
  title: string
  defaultOpen?: boolean
  /** Accent color class for the icon ring — e.g. "text-cyan-300" */
  accentClass?: string
  children: ReactNode
}

export function CollapsibleCard({
  id,
  icon,
  title,
  defaultOpen = false,
  accentClass = 'text-slate-400',
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(`hermes-card-${id}`)
      if (saved !== null) return saved === '1'
    } catch { /* noop */ }
    return defaultOpen
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(`hermes-card-${id}`, next ? '1' : '0') } catch { /* noop */ }
  }

  return (
    <div className="group/card rounded-2xl border border-white/[0.07] bg-white/[0.03] transition-all duration-200 hover:border-white/[0.12]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] transition-colors duration-200 group-hover/card:bg-white/[0.10] ${accentClass}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium tracking-[0.12em] uppercase text-slate-400 transition-colors duration-200 group-hover/card:text-slate-300">
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-all duration-200 ${
            open ? 'rotate-0' : '-rotate-90'
          }`}
        />
      </button>
      {open ? (
        <div className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </div>
  )
}
