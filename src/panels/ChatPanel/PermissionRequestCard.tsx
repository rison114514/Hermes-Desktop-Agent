import { FormEvent, useMemo, useState } from 'react'
import { ShieldAlert, Terminal } from 'lucide-react'
import type { HermesPermissionRequest } from '../../../electron/hermes-bridge'
import { useChatStore } from '@/store/chat'
import { cn } from '@/lib/utils'

type PermissionRequestCardProps = {
  request: HermesPermissionRequest
}

export function PermissionRequestCard({ request }: PermissionRequestCardProps) {
  const [choice, setChoice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const removePermissionRequest = useChatStore((state) => state.removePermissionRequest)
  const options = request.options
  const numberedOptions = useMemo(() => options.map((option, index) => ({ ...option, number: index + 1 })), [options])

  const submitOption = async (optionId: string | null) => {
    if (!window.hermesDesktop || submitting) {
      return
    }

    setSubmitting(true)
    try {
      await window.hermesDesktop.respondHermesPermission(request.requestId, optionId)
      removePermissionRequest(request.requestId)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = choice.trim().toLowerCase()
    const selected = numberedOptions.find((option) =>
      String(option.number) === normalized
      || option.optionId.toLowerCase() === normalized
      || option.name.toLowerCase() === normalized,
    )

    if (selected) {
      void submitOption(selected.optionId)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-4 shadow-2xl shadow-black/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-amber-200/20 bg-amber-200/10 p-2 text-amber-100">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">Hermes permission request</p>
            {request.toolKind ? (
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">{request.toolKind}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-300">{request.title}</p>
          {request.description ? <p className="mt-1 text-xs text-slate-400">{request.description}</p> : null}
        </div>
      </div>

      {request.command ? (
        <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-black/30">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-400">
            <Terminal className="h-3.5 w-3.5" />
            command
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-5 text-slate-200">{request.command}</pre>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {numberedOptions.map((option) => (
          <button
            key={option.optionId}
            type="button"
            disabled={submitting}
            onClick={() => void submitOption(option.optionId)}
            className={cn(
              'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition',
              isDenyOption(option.optionId, option.name)
                ? 'border-rose-300/20 bg-rose-300/10 text-rose-100 hover:border-rose-200/40'
                : 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:border-cyan-200/40',
              submitting && 'cursor-not-allowed opacity-60',
            )}
          >
            <span className="min-w-0 truncate">{option.name}</span>
            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-200">{option.number}</span>
          </button>
        ))}
        {!numberedOptions.length ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submitOption(null)}
            className="rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-left text-sm text-rose-100 transition hover:border-rose-200/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel request
          </button>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={submitting}
          placeholder="Type option number or name..."
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-200/50"
        />
        <button
          type="submit"
          disabled={submitting || !choice.trim()}
          className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm
        </button>
      </form>
    </div>
  )
}

function isDenyOption(optionId: string, name: string) {
  const haystack = `${optionId} ${name}`.toLowerCase()
  return haystack.includes('deny') || haystack.includes('reject') || haystack.includes('cancel')
}
