import { create } from 'zustand'
import type { ApiLogEntry } from '../types'

interface LogsState {
  entries: ApiLogEntry[]
  load: (workspace: string) => Promise<void>
  prepend: (entry: ApiLogEntry) => void
  reveal: (workspace: string) => Promise<void>
}

export const useLogs = create<LogsState>((set, get) => ({
  entries: [],
  load: async (workspace) => {
    const list = await window.api.logs.listRecent(workspace, 200)
    set({ entries: list })
  },
  prepend: (entry) => set({ entries: [entry, ...get().entries].slice(0, 500) }),
  reveal: async (workspace) => {
    await window.api.logs.reveal(workspace)
  }
}))
