import { create } from 'zustand'

export type ThemeId = 'midnight' | 'slate' | 'parchment'

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'midnight', name: 'Midnight — dark blue' },
  { id: 'slate', name: 'Slate — dark neutral' },
  { id: 'parchment', name: 'Parchment — light' }
]

const STORAGE_KEY = 'story-tavern.theme'
const DEFAULT_THEME: ThemeId = 'midnight'

function isThemeId(v: unknown): v is ThemeId {
  return v === 'midnight' || v === 'slate' || v === 'parchment'
}

export function readStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Set the theme attribute on <html> — this is what swaps the whole palette. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
}

interface ThemeState {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const useTheme = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* ignore — theme just won't persist */
    }
    set({ theme })
  }
}))
