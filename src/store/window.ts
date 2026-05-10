import { create } from 'zustand'

interface DesktopWindowState {
  visible: boolean
  alwaysOnTop: boolean
}

interface DesktopWindowStore extends DesktopWindowState {
  setState: (state: Partial<DesktopWindowState>) => void
}

export const useDesktopWindowStore = create<DesktopWindowStore>((set) => ({
  visible: true,
  alwaysOnTop: false,
  setState: (state) => set((current) => ({ ...current, ...state })),
}))
