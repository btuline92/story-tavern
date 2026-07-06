import { create } from 'zustand'
import type { Plugin } from '../types'

interface PluginsState {
  plugins: Plugin[]
  selectedId: string | null
  loading: boolean
  load: (workspace: string) => Promise<void>
  create: (workspace: string, name: string) => Promise<Plugin>
  save: (workspace: string, plugin: Plugin) => Promise<void>
  delete: (workspace: string, id: string) => Promise<void>
  select: (id: string | null) => void
}

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  selectedId: null,
  loading: false,
  load: async (workspace) => {
    set({ loading: true })
    const plugins = await window.api.plugins.list(workspace)
    set({ plugins, loading: false })
  },
  create: async (workspace, name) => {
    const created = await window.api.plugins.create(workspace, name)
    const plugins = await window.api.plugins.list(workspace)
    set({ plugins, selectedId: created.id })
    return created
  },
  save: async (workspace, plugin) => {
    const saved = await window.api.plugins.save(workspace, plugin)
    const plugins = await window.api.plugins.list(workspace)
    set({ plugins, selectedId: saved.id })
  },
  delete: async (workspace, id) => {
    await window.api.plugins.delete(workspace, id)
    const plugins = await window.api.plugins.list(workspace)
    const nextSelected = get().selectedId === id ? null : get().selectedId
    set({ plugins, selectedId: nextSelected })
  },
  select: (id) => set({ selectedId: id })
}))
