import { create } from 'zustand'

type Status = 'loading' | 'needs-pick' | 'ready'

interface WorkspaceState {
  status: Status
  path: string | null
  init: () => Promise<void>
  pick: () => Promise<void>
  switchWorkspace: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  status: 'loading',
  path: null,
  init: async () => {
    const last = await window.api.workspace.getLast()
    if (last) {
      await window.api.workspace.ensure(last)
      set({ status: 'ready', path: last })
    } else {
      set({ status: 'needs-pick', path: null })
    }
  },
  pick: async () => {
    const picked = await window.api.workspace.pick()
    if (picked) set({ status: 'ready', path: picked })
  },
  switchWorkspace: async () => {
    const picked = await window.api.workspace.pick()
    if (picked) set({ status: 'ready', path: picked })
  }
}))
