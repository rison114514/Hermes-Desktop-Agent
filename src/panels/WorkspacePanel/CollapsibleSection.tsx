import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type CollapsibleSectionProps = {
  title: string
  icon: ReactNode
  children: ReactNode
  className?: string
  defaultOpen?: boolean
}

export function CollapsibleSection({
  title,
  icon,
  children,
  className,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={cn('rounded-[28px] border border-white/10 bg-white/5 p-4', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}
