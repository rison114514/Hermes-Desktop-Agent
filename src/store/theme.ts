import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('hermes-theme')
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initial = readStoredTheme()
  applyTheme(initial)

  return {
    theme: initial,
    setTheme: (theme) => {
      try {
        localStorage.setItem('hermes-theme', theme)
      } catch {
        // localStorage unavailable
      }
      applyTheme(theme)
      set({ theme })
    },
  }
})
