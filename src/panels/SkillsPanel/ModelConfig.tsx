import { useSkillsStore } from '@/store/skills'

export function ModelConfig() {
  const provider = useSkillsStore((state) => state.provider)
  const model = useSkillsStore((state) => state.model)
  const source = useSkillsStore((state) => state.source)

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">配置</p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Provider</p>
        <p className="mt-1 text-sm text-slate-100">{provider}</p>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Model</p>
        <p className="mt-1 break-all text-sm text-slate-100">{model}</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        当前 Hermes 运行模型直接读取自 <code>{source}</code>。目前还没有接入交互式模型切换，
        所以这里展示的是实际生效的 provider / model，而不是误导性的演示下拉框。
      </p>
    </div>
  )
}
