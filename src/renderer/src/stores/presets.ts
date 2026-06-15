import { create } from 'zustand'
import type { Preset } from '../types'

interface PresetsState {
  presets: Preset[]
  selectedId: string | null
  loading: boolean
  load: (workspace: string) => Promise<void>
  create: (workspace: string, name: string) => Promise<Preset>
  save: (workspace: string, preset: Preset) => Promise<void>
  delete: (workspace: string, id: string) => Promise<void>
  importPreset: (workspace: string) => Promise<Preset | null>
  exportPreset: (workspace: string, id: string) => Promise<string | null>
  select: (id: string | null) => void
}

export const usePresets = create<PresetsState>((set, get) => ({
  presets: [],
  selectedId: null,
  loading: false,
  load: async (workspace) => {
    set({ loading: true })
    const presets = await window.api.presets.list(workspace)
    set({ presets, loading: false })
  },
  create: async (workspace, name) => {
    const created = await window.api.presets.create(workspace, name)
    const presets = await window.api.presets.list(workspace)
    set({ presets, selectedId: created.id })
    return created
  },
  save: async (workspace, preset) => {
    const saved = await window.api.presets.save(workspace, preset)
    const presets = await window.api.presets.list(workspace)
    set({ presets, selectedId: saved.id })
  },
  delete: async (workspace, id) => {
    await window.api.presets.delete(workspace, id)
    const presets = await window.api.presets.list(workspace)
    const nextSelected = get().selectedId === id ? null : get().selectedId
    set({ presets, selectedId: nextSelected })
  },
  importPreset: async (workspace) => {
    const imported = await window.api.presets.import(workspace)
    if (!imported) return null
    const presets = await window.api.presets.list(workspace)
    set({ presets, selectedId: imported.id })
    return imported
  },
  exportPreset: async (workspace, id) => {
    return window.api.presets.export(workspace, id)
  },
  select: (id) => set({ selectedId: id })
}))
