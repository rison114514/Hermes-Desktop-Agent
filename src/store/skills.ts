import { create } from 'zustand'

export interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
  category?: string
}

interface SkillsStore {
  provider: string
  model: string
  source: string
  skills: SkillItem[]
  toggleSkill: (id: string) => void
  setHermesConfig: (config: { provider: string; model: string; source: string }) => void
  setSkills: (skills: SkillItem[]) => void
}

export const useSkillsStore = create<SkillsStore>((set) => ({
  provider: 'custom',
  model: '读取中...',
  source: '~/.hermes/config.yaml',
  skills: [
    { id: 'web', name: 'web', description: '浏览并校验外部信息。', enabled: true },
    { id: 'github', name: 'github', description: '处理仓库、Issue 与 PR 元数据。', enabled: false },
    { id: 'arxiv', name: 'arxiv', description: '检索论文与技术参考资料。', enabled: false },
    { id: 'terminal', name: 'terminal', description: '在当前项目工作区执行本地终端命令。', enabled: true },
  ],
  toggleSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === id ? { ...skill, enabled: !skill.enabled } : skill,
      ),
    })),
  setHermesConfig: ({ provider, model, source }) => set({ provider, model, source }),
  setSkills: (skills) => set({ skills }),
}))
