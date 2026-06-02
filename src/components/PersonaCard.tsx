import { useEffect, useState } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { usePersonaStore } from '@/store/persona'
import type { Persona } from '@/store/persona'

export function PersonaCard() {
  const personas = usePersonaStore((state) => state.personas)
  const setPersonas = usePersonaStore((state) => state.setPersonas)
  const activeId = usePersonaStore((state) => state.activeId)
  const setActive = usePersonaStore((state) => state.setActive)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!window.hermesDesktop?.readPersonas) return
    window.hermesDesktop.readPersonas().then((list) => {
      if (list.length > 0) setPersonas(list)
    }).catch(() => { /* noop */ })
  }, [])

  const activePersona = personas.find((p) => p.name === activeId)

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-amber-200" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">人格</p>
            {!open && activePersona ? (
              <p className="mt-0.5 truncate text-[11px] text-amber-100/80">{activePersona.name}</p>
            ) : null}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="mt-4 space-y-2">
          {personas.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-500">未找到人格定义</p>
          ) : (
            personas.map((p) => {
              const isActive = activeId === p.name
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setActive(p.name)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? 'border-amber-300/30 bg-amber-300/12'
                      : 'border-white/10 bg-slate-950/80 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{iconFor(p.icon)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${isActive ? 'text-amber-100' : 'text-slate-100'}`}>
                        {p.name}
                        {isActive ? <span className="ml-1.5 text-[11px] text-amber-200/70">当前</span> : null}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{p.description}</p>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

function iconFor(icon: string): string {
  switch (icon) {
    case 'pen': return '✍️'
    case 'code': return '💻'
    case 'book': return '📖'
    case 'bot': return '🤖'
    default: return '🧩'
  }
}
