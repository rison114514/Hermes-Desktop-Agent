import { useSkillsStore } from '@/store/skills'

export function ModelConfig() {
  const provider = useSkillsStore((state) => state.provider)
  const model = useSkillsStore((state) => state.model)
  const source = useSkillsStore((state) => state.source)

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Config</p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">provider</p>
        <p className="mt-1 text-sm text-slate-100">{provider}</p>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">model</p>
        <p className="mt-1 break-all text-sm text-slate-100">{model}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        Current Hermes runtime model is read from <code>{source}</code>. Interactive switching is not wired yet,
        so this panel shows the actual configured provider/model instead of a misleading hard-coded selector.
      </p>
    </div>
  )
}
