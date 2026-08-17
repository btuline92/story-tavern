import { create } from 'zustand'
import type { Lorebook } from '../types'

interface LorebooksState {
  lorebooks: Lorebook[]
  selectedId: string | null
  loading: boolean
  load: (workspace: string) => Promise<void>
  create: (workspace: string, name: string) => Promise<Lorebook>
  save: (workspace: string, lorebook: Lorebook) => Promise<void>
  delete: (workspace: string, id: string) => Promise<void>
  /** Open a file dialog to import a SillyTavern lorebook; selects it. Returns null if cancelled. */
  import: (workspace: string) => Promise<Lorebook | null>
  /** Export a lorebook to a SillyTavern World Info JSON via a save dialog. Returns the path or null. */
  export: (workspace: string, id: string) => Promise<string | null>
  select: (id: string | null) => void
}

export const useLorebooks = create<LorebooksState>((set, get) => ({
  lorebooks: [],
  selectedId: null,
  loading: false,
  load: async (workspace) => {
    set({ loading: true })
    const lorebooks = await window.api.lorebooks.list(workspace)
    set({ lorebooks, loading: false })
  },
  create: async (workspace, name) => {
    const created = await window.api.lorebooks.create(workspace, name)
    const lorebooks = await window.api.lorebooks.list(workspace)
    set({ lorebooks, selectedId: created.id })
    return created
  },
  save: async (workspace, lorebook) => {
    const saved = await window.api.lorebooks.save(workspace, lorebook)
    const lorebooks = await window.api.lorebooks.list(workspace)
    set({ lorebooks, selectedId: saved.id })
  },
  delete: async (workspace, id) => {
    await window.api.lorebooks.delete(workspace, id)
    const lorebooks = await window.api.lorebooks.list(workspace)
    const nextSelected = get().selectedId === id ? null : get().selectedId
    set({ lorebooks, selectedId: nextSelected })
  },
  import: async (workspace) => {
    const imported = await window.api.lorebooks.import(workspace)
    if (!imported) return null
    const lorebooks = await window.api.lorebooks.list(workspace)
    set({ lorebooks, selectedId: imported.id })
    return imported
  },
  export: async (workspace, id) => {
    return window.api.lorebooks.export(workspace, id)
  },
  select: (id) => set({ selectedId: id })
}))
