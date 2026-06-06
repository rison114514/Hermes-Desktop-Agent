import { create } from 'zustand'

export interface SessionTab {
  id: string
  name: string
  cwd: string
}

interface SessionStore {
  sessions: SessionTab[]
  activeId: string | null
  setSessions: (sessions: SessionTab[]) => void
  setActive: (id: string | null) => void
  addSession: (session: SessionTab) => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,

  setSessions: (sessions) => set({ sessions }),
  setActive: (id) => set({ activeId: id }),
  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions.filter((s2) => s2.id !== session.id), session],
      activeId: session.id,
    })),
  removeSession: (id) =>
    set((s) => {
      const next = s.sessions.filter((s2) => s2.id !== id)
      return {
        sessions: next,
        activeId: s.activeId === id ? (next[0]?.id ?? null) : s.activeId,
      }
    }),
  renameSession: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((s2) => (s2.id === id ? { ...s2, name } : s2)),
    })),
}))
