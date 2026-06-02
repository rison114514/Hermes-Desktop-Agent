import { create } from 'zustand'

export interface SidebarCard {
  id: string
  title: string
  visible: boolean
}

type CardOrder = string[]

interface SidebarStore {
  order: CardOrder
  setOrder: (order: CardOrder) => void
  moveCard: (dragId: string, overId: string) => void
}

const STORAGE_KEY = 'hermes-sidebar-order'
const DEFAULT_ORDER = ['skills', 'model', 'proxy', 'mods', 'mod-panels']

function readOrder(): CardOrder {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        // Ensure all default cards are present (new cards added in updates)
        const existing = new Set(parsed)
        for (const id of DEFAULT_ORDER) {
          if (!existing.has(id)) parsed.push(id)
        }
        return parsed
      }
    }
  } catch { /* noop */ }
  return [...DEFAULT_ORDER]
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  order: readOrder(),

  setOrder: (order) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)) } catch { /* noop */ }
    set({ order })
  },

  moveCard: (dragId, overId) =>
    set((state) => {
      const from = state.order.indexOf(dragId)
      const to = state.order.indexOf(overId)
      if (from === -1 || to === -1 || from === to) return state

      const next = [...state.order]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return { order: next }
    }),
}))
