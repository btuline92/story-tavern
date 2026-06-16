import { create } from 'zustand'
import type { ImageSettings, OpenRouterSettings, ProviderId, WorkspaceSettings } from '../types'

interface SettingsState {
  settings: WorkspaceSettings | null
  hasKey: Record<ProviderId, boolean>
  loaded: boolean
  load: (workspace: string) => Promise<void>
  refreshKeys: () => Promise<void>
  setProvider: (workspace: string, provider: ProviderId) => Promise<void>
  setModel: (workspace: string, provider: ProviderId, model: string) => Promise<void>
  setActivePresetId: (workspace: string, id: string | null) => Promise<void>
  setImage: (workspace: string, patch: Partial<ImageSettings>) => Promise<void>
  setOpenRouter: (workspace: string, patch: Partial<OpenRouterSettings>) => Promise<void>
  saveKey: (provider: ProviderId, key: string) => Promise<void>
  deleteKey: (provider: ProviderId) => Promise<void>
}

const EMPTY_HAS_KEY: Record<ProviderId, boolean> = {
  anthropic: false,
  openai: false,
  openrouter: false,
  deepseek: false
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
  setProvider: async (workspace, provider) => {
    const current = get().settings
    if (!current) return
    await persist(workspace, set, { ...current, selectedProvider: provider })
  },
  setModel: async (workspace, provider, model) => {
    const current = get().settings
    if (!current) return
    const next: WorkspaceSettings = {
      ...current,
      models: { ...current.models, [provider]: model }
    }
    await persist(workspace, set, next)
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
  saveKey: async (provider, key) => {
    await window.api.keys.set(provider, key)
    set({ hasKey: { ...get().hasKey, [provider]: true } })
  },
  deleteKey: async (provider) => {
    await window.api.keys.delete(provider)
    set({ hasKey: { ...get().hasKey, [provider]: false } })
  }
}))
