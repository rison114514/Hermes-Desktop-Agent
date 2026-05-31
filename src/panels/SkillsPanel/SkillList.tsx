import { useState, useMemo } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { useSkillsStore } from '@/store/skills'
import { cn } from '@/lib/utils'

export function SkillList() {
  const skills = useSkillsStore((state) => state.skills)
  const toggleSkill = useSkillsStore((state) => state.toggleSkill)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [skills, searchQuery])

  return (
    <div>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索技能..."
          className="w-full rounded-xl border border-white/10 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-300/50"
        />
      </div>
      <div className="space-y-3">
        {filteredSkills.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {searchQuery.trim() ? '未找到匹配的技能' : '暂无可用技能'}
          </p>
        ) : (
          filteredSkills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          onClick={() => toggleSkill(skill.id)}
          className={cn(
            'w-full rounded-[24px] border p-4 text-left transition',
            skill.enabled
              ? 'border-cyan-300/30 bg-cyan-400/12 shadow-[0_20px_45px_rgba(8,145,178,0.12)]'
              : 'border-white/[0.08] bg-white/[0.04] hover:border-white/14 hover:bg-white/[0.07]',
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{skill.name}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                {skill.category ? `${skill.category} · ` : ''}
                {skill.description}
              </p>
            </div>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border',
                skill.enabled ? 'border-cyan-200/40 bg-cyan-200/20 text-cyan-100' : 'border-white/10 text-slate-500',
              )}
            >
              {skill.enabled ? <Check className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </div>
        </button>
        )))}
      </div>
    </div>
  )
}
