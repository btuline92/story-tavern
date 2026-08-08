import { create } from 'zustand'

// Photography's form state lives in a module-level store (not component state) so it survives
// navigating away to another tab and back — letting you tweak the scene instruction / system
// prompt once, then pull different scenes from the Stories tab without losing your edits.
// The scratchpad overrides are null on first load (showing the saved text); they reset to null
// only when a new base prompt is picked or "Reset to saved" is hit, and otherwise persist.
// Transient generation runtime (loading, result, etc.) stays local to the component.

interface PhotographyState {
  mode: 'scene' | 'prompt'
  selectedIds: string[]
  sceneText: string
  directPrompt: string
  prefixName: string
  /** Which saved tag prompt the scene-instruction scratchpad is based on. */
  tagPromptName: string
  /** Ephemeral scene-instruction edit; null = use the selected tag prompt's saved text. */
  tagInstructionOverride: string | null
  /** Ephemeral system-prompt edit; null = use the active system prompt's saved text. */
  systemOverride: string | null
  setMode: (mode: 'scene' | 'prompt') => void
  setSelectedIds: (selectedIds: string[]) => void
  setSceneText: (sceneText: string) => void
  setDirectPrompt: (directPrompt: string) => void
  setPrefixName: (prefixName: string) => void
  setTagPromptName: (tagPromptName: string) => void
  setTagInstructionOverride: (tagInstructionOverride: string | null) => void
  setSystemOverride: (systemOverride: string | null) => void
}

export const usePhotography = create<PhotographyState>((set) => ({
  mode: 'scene',
  selectedIds: [],
  sceneText: '',
  directPrompt: '',
  prefixName: '',
  tagPromptName: '',
  tagInstructionOverride: null,
  systemOverride: null,
  setMode: (mode) => set({ mode }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setSceneText: (sceneText) => set({ sceneText }),
  setDirectPrompt: (directPrompt) => set({ directPrompt }),
  setPrefixName: (prefixName) => set({ prefixName }),
  setTagPromptName: (tagPromptName) => set({ tagPromptName }),
  setTagInstructionOverride: (tagInstructionOverride) => set({ tagInstructionOverride }),
  setSystemOverride: (systemOverride) => set({ systemOverride })
}))
