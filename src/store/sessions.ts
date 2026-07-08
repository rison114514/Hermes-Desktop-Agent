import { create } from 'zustand'

export type WorkbenchTabType = 'session' | 'model-config'

export interface SessionTab {
  id: string
  name: string
  cwd: string
  type?: WorkbenchTabType
  kind?: 'chat' | 'model-config'
  icon?: string
  closable?: boolean
  detachable?: boolean
  payload?: Record<string, unknown>
}

interface SessionStore {
  sessions: SessionTab[]
  activeId: string | null
  setSessions: (sessions: SessionTab[]) => void
  setActive: (id: string | null) => void
  openTab: (tab: SessionTab, options?: { activate?: boolean }) => void
  activateTab: (id: string | null) => void
  closeTab: (id: string) => void
  addSession: (session: SessionTab) => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
}

export function getTabType(tab: SessionTab | null | undefined): WorkbenchTabType {
  return tab?.type ?? (tab?.kind === 'model-config' ? 'model-config' : 'session')
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,

  setSessions: (sessions) => set({ sessions }),
  setActive: (id) => set({ activeId: id }),
  openTab: (tab, options) =>
    set((s) => ({
      sessions: [...s.sessions.filter((s2) => s2.id !== tab.id), tab],
      activeId: options?.activate === false ? s.activeId : tab.id,
    })),
  activateTab: (id) => set({ activeId: id }),
  closeTab: (id) =>
    set((s) => {
      const next = s.sessions.filter((s2) => s2.id !== id)
      return {
        sessions: next,
        activeId: s.activeId === id ? (next[0]?.id ?? null) : s.activeId,
      }
    }),
  addSession: (session) => get().openTab({ ...session, type: session.type ?? 'session' }),
  removeSession: (id) => get().closeTab(id),
  renameSession: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((s2) => (s2.id === id ? { ...s2, name } : s2)),
    })),
}))
