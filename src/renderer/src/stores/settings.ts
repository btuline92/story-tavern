import { create } from 'zustand'
import type {
  ImageSettings,
  OpenRouterSettings,
  ProviderId,
  WorkspaceSettings
} from '../types'

interface SettingsState {
  settings: WorkspaceSettings | null
  hasKey: Record<ProviderId, boolean>
  loaded: boolean
  load: (workspace: string) => Promise<void>
  refreshKeys: () => Promise<void>
  setActivePresetId: (workspace: string, id: string | null) => Promise<void>
  setImage: (workspace: string, patch: Partial<ImageSettings>) => Promise<void>
  setOpenRouter: (workspace: string, patch: Partial<OpenRouterSettings>) => Promise<void>
  setMagicAutoStart: (workspace: string, value: boolean) => Promise<void>
  setMagicBeatPrompt: (workspace: string, value: string) => Promise<void>
  setOutlineToBeats: (workspace: string, value: boolean) => Promise<void>
  /** Set the model preset used for generation (used by the story-editor switcher). */
  setActiveModelPreset: (workspace: string, id: string) => Promise<void>
  saveKey: (provider: ProviderId, key: string) => Promise<void>
  deleteKey: (provider: ProviderId) => Promise<void>
}

const EMPTY_HAS_KEY: Record<ProviderId, boolean> = {
  anthropic: false,
  openai: false,
  openrouter: false,
  deepseek: false,
  nanogpt: false,
  featherless: false
}

async function persist(
  workspace: string,
  set: (partial: Partial<SettingsState>) => void,
  next: WorkspaceSettings
): Promise<void> {
  await window.api.workspace.setSettings(workspace, next)
  set({ settings: next })
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  hasKey: { ...EMPTY_HAS_KEY },
  loaded: false,
  load: async (workspace) => {
    const [settings, hasKey] = await Promise.all([
      window.api.workspace.getSettings(workspace),
      window.api.keys.has()
    ])
    set({ settings, hasKey, loaded: true })
  },
  refreshKeys: async () => {
    const hasKey = await window.api.keys.has()
    set({ hasKey })
  },
  setActivePresetId: async (workspace, id) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, activePresetId: id })
  },
  setImage: async (workspace, patch) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, image: { ...current.image, ...patch } })
  },
  setOpenRouter: async (workspace, patch) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, {
      ...current,
      openrouter: { ...current.openrouter, ...patch }
    })
  },
  setMagicAutoStart: async (workspace, value) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, magicAutoStart: value })
  },
  setMagicBeatPrompt: async (workspace, value) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, magicBeatPrompt: value })
  },
  setOutlineToBeats: async (workspace, value) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, outlineToBeats: value })
  },
  setActiveModelPreset: async (workspace, id) => {
    const current = get().settings
    if (!current || current.activeModelPresetId === id) return
    if (!current.modelPresets.some((p) => p.id === id)) return
    await persist(workspace, set, { ...current, activeModelPresetId: id })
  },
  saveKey: async (provider, key) => {
    await window.api.keys.set(provider, key)
    set({ hasKey: { ...get().hasKey, [provider]: true } })
  },
  deleteKey: async (provider) => {
    await window.api.keys.delete(provider)
    set({ hasKey: { ...get().hasKey, [provider]: false } })
  }
}))
