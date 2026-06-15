import { create } from 'zustand'
import type { Character, TavernV2Data } from '../types'

export interface CharacterUpdate {
  name?: string
  description?: string
  tavern_data?: Partial<TavernV2Data>
}

interface CharactersState {
  characters: Character[]
  selectedId: string | null
  loading: boolean
  load: (workspace: string) => Promise<void>
  importCard: (workspace: string) => Promise<void>
  createNew: (workspace: string) => Promise<Character>
  update: (workspace: string, id: string, patch: CharacterUpdate) => Promise<Character>
  pickAvatar: (workspace: string, id: string) => Promise<Character | null>
  exportCard: (workspace: string, id: string, name: string) => Promise<string | null>
  select: (id: string | null) => void
  remove: (workspace: string, id: string) => Promise<void>
}

export const useCharacters = create<CharactersState>((set, get) => ({
  characters: [],
  selectedId: null,
  loading: false,
  load: async (workspace) => {
    set({ loading: true })
    const list = (await window.api.characters.list(workspace)) as Character[]
    set({ characters: list, loading: false })
  },
  importCard: async (workspace) => {
    const result = (await window.api.characters.pickAndImport(workspace)) as Character | null
    if (!result) return
    const list = (await window.api.characters.list(workspace)) as Character[]
    set({ characters: list, selectedId: result.id })
  },
  createNew: async (workspace) => {
    const created = (await window.api.characters.create(workspace)) as Character
    const list = (await window.api.characters.list(workspace)) as Character[]
    set({ characters: list, selectedId: created.id })
    return created
  },
  update: async (workspace, id, patch) => {
    const updated = (await window.api.characters.update(workspace, id, patch)) as Character
    const list = (await window.api.characters.list(workspace)) as Character[]
    set({ characters: list, selectedId: updated.id })
    return updated
  },
  pickAvatar: async (workspace, id) => {
    const result = (await window.api.characters.pickAvatar(workspace, id)) as Character | null
    if (!result) return null
    const list = (await window.api.characters.list(workspace)) as Character[]
    set({ characters: list })
    return result
  },
  exportCard: async (workspace, id, name) => {
    return window.api.characters.exportCard(workspace, id, name)
  },
  select: (id) => set({ selectedId: id }),
  remove: async (workspace, id) => {
    await window.api.characters.delete(workspace, id)
    const list = (await window.api.characters.list(workspace)) as Character[]
    const nextSelected = get().selectedId === id ? null : get().selectedId
    set({ characters: list, selectedId: nextSelected })
  }
}))
