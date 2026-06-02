import { create } from 'zustand'

export interface Persona {
  name: string
  icon: string
  description: string
  activation: string
}

interface PersonaStore {
  personas: Persona[]
  activeId: string | null
  pendingSwitch: string | null
  setPersonas: (personas: Persona[]) => void
  setActive: (id: string | null) => void
  consumePendingSwitch: () => Persona | null
}

const STORAGE_KEY = 'hermes-persona'

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const usePersonaStore = create<PersonaStore>((set, get) => ({
  personas: [],
  activeId: readStoredId(),
  pendingSwitch: null,

  setPersonas: (personas) => set({ personas }),

  setActive: (id) => {
    const prev = get().activeId
    if (prev === id) {
      // Same persona clicked again — toggle off
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      set({ activeId: null, pendingSwitch: null })
      return
    }
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* noop */ }
    set({ activeId: id, pendingSwitch: id })
  },

  consumePendingSwitch: () => {
    const id = get().pendingSwitch
    if (!id) return null
    const persona = get().personas.find((p) => p.name === id)
    set({ pendingSwitch: null })
    return persona ?? null
  },
}))
