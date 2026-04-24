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
  model: 'loading...',
  source: '~/.hermes/config.yaml',
  skills: [
    { id: 'web', name: 'web', description: 'Browse and verify external information.', enabled: true },
    { id: 'github', name: 'github', description: 'Work with issues, PRs, and repository metadata.', enabled: false },
    { id: 'arxiv', name: 'arxiv', description: 'Inspect research papers and technical references.', enabled: false },
    { id: 'terminal', name: 'terminal', description: 'Use local shell tools in the project workspace.', enabled: true },
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
