import { create } from 'zustand'
import type { Chapter, ImageGenResult, ImagePhase, StoryMeta, StoryWithChapters } from '../types'
import { useSettings } from './settings'

function newGenId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Build a Markdown image marker, sanitizing the prompt for the title attribute. */
function imageMarker(relPath: string, positive: string): string {
  const title = positive.replace(/\s+/g, ' ').replace(/"/g, "'").trim()
  return `![scene](${relPath} "${title}")`
}

/** Count prose words in a chapter, ignoring inline image markers. */
const IMAGE_MARKER_RE = /!\[[^\]]*\]\([^)]*\)/g
function chapterWordCount(active: StoryWithChapters | null, chapterNumber: number): number {
  const ch = active?.chapters.find((c) => c.number === chapterNumber)
  if (!ch) return 0
  return (ch.content.replace(IMAGE_MARKER_RE, '').trim().match(/\S+/g) ?? []).length
}

// Resolves the in-flight one-click chunk once its generation settles (done or error).
let settleChunk: ((result: 'done' | 'error') => void) | null = null
function settleActiveChunk(result: 'done' | 'error'): void {
  if (settleChunk) {
    const f = settleChunk
    settleChunk = null
    f(result)
  }
}

interface StoriesState {
  stories: StoryMeta[]
  selectedId: string | null
  active: StoryWithChapters | null
  activeChapterNumber: number | null
  loading: boolean
  generating: boolean
  generationStreamId: string | null
  generationStartedAt: number | null
  streamBuffer: string
  /** Captured chain-of-thought from the model (Anthropic thinking_delta /
   *  DeepSeek reasoning_content / OpenRouter reasoning). Display-only; not saved
   *  to the chapter when generation completes. */
  reasoningBuffer: string
  generationError: string | null
  /** Bumps every time an external (non-user-typing) mutation lands on the active chapter,
   *  i.e. Continue completes. The chapter editor watches this to re-sync its drafts. */
  externalChapterRevision: number
  /** Chapter content snapshot taken just before the in-flight generation, used to undo
   *  for Regenerate. Set when a generation starts. */
  pendingGenBefore: string | null
  /** The last completed generation: lets Regenerate restore and retry. */
  lastGen: { chapterNumber: number; before: string; after: string } | null
  /** Inline image generation (after Continue, or manual). Independent of text streaming. */
  imageGenerating: boolean
  imageStatus: ImagePhase | null
  imageError: string | null
  imageGenId: string | null
  /** One-click "write to target length" loop state. */
  oneClickActive: boolean
  oneClickTarget: number | null
  oneClickChunk: number
  /** Text of the most recently generated chunk — the one-click loop uses it for that chunk's image. */
  lastGeneratedText: string
  loadList: (workspace: string) => Promise<void>
  open: (workspace: string, id: string) => Promise<void>
  closeActive: () => void
  create: (
    workspace: string,
    input: {
      title: string
      characterIds: string[]
      presetId: string | null
      pluginIds?: string[]
      premise?: string
    }
  ) => Promise<StoryWithChapters>
  updateMeta: (
    workspace: string,
    id: string,
    patch: {
      title?: string
      characterIds?: string[]
      presetId?: string | null
      pluginIds?: string[]
      premise?: string
      notes?: string
    }
  ) => Promise<void>
  remove: (workspace: string, id: string) => Promise<void>
  updateChapter: (
    workspace: string,
    chapterNumber: number,
    patch: { title?: string; outline?: string; content?: string }
  ) => Promise<Chapter>
  addChapter: (workspace: string) => Promise<void>
  selectChapter: (chapterNumber: number) => void
  startContinue: (workspace: string, userNote?: string, targetWords?: number) => Promise<void>
  regenerate: (workspace: string, userNote?: string) => Promise<void>
  cancelContinue: () => Promise<void>
  /** Repeatedly Continue (one chunk + image per pass) until the chapter hits targetWords. */
  startOneClick: (workspace: string, targetWords: number) => Promise<void>
  stopOneClick: () => Promise<void>
  /** Generate an inline image for a passage and append its marker to the chapter. */
  generateImage: (workspace: string, chapterNumber: number, passageText: string) => Promise<void>
  /** Generate an image and return the result without inserting it (for in-place replace). */
  regenerateImage: (
    workspace: string,
    chapterNumber: number,
    passageText: string
  ) => Promise<ImageGenResult | null>
  cancelImage: () => Promise<void>
  /** Internal: called by IPC subscribers wired in App. */
  _onStreamDelta: (streamId: string, delta: string) => void
  _onStreamReasoning: (streamId: string, delta: string) => void
  _onStreamDone: (workspace: string, streamId: string, fullText: string) => Promise<void>
  _onStreamError: (streamId: string, error: string) => void
  _onImageProgress: (genId: string, phase: ImagePhase) => void
}

export const useStories = create<StoriesState>((set, get) => ({
  stories: [],
  selectedId: null,
  active: null,
  activeChapterNumber: null,
  loading: false,
  generating: false,
  generationStreamId: null,
  generationStartedAt: null,
  streamBuffer: '',
  reasoningBuffer: '',
  generationError: null,
  externalChapterRevision: 0,
  pendingGenBefore: null,
  lastGen: null,
  imageGenerating: false,
  imageStatus: null,
  imageError: null,
  imageGenId: null,
  oneClickActive: false,
  oneClickTarget: null,
  oneClickChunk: 0,
  lastGeneratedText: '',
  loadList: async (workspace) => {
    set({ loading: true })
    const list = await window.api.stories.list(workspace)
    set({ stories: list, loading: false })
  },
  open: async (workspace, id) => {
    const story = await window.api.stories.load(workspace, id)
    set({
      active: story,
      selectedId: id,
      activeChapterNumber: story?.chapters[0]?.number ?? null,
      generationError: null,
      streamBuffer: '',
      reasoningBuffer: '',
      lastGen: null
    })
  },
  closeActive: () =>
    set({
      active: null,
      selectedId: null,
      activeChapterNumber: null,
      generationError: null,
      streamBuffer: '',
      reasoningBuffer: '',
      lastGen: null
    }),
  create: async (workspace, input) => {
    const story = await window.api.stories.create(workspace, input)
    const list = await window.api.stories.list(workspace)
    set({
      stories: list,
      active: story,
      selectedId: story.meta.id,
      activeChapterNumber: story.chapters[0]?.number ?? null,
      generationError: null,
      streamBuffer: '',
      reasoningBuffer: ''
    })
    return story
  },
  updateMeta: async (workspace, id, patch) => {
    await window.api.stories.updateMeta(workspace, id, patch)
    const list = await window.api.stories.list(workspace)
    const current = get().active
    if (current && current.meta.id === id) {
      const reloaded = await window.api.stories.load(workspace, id)
      set({ stories: list, active: reloaded })
    } else {
      set({ stories: list })
    }
  },
  remove: async (workspace, id) => {
    await window.api.stories.delete(workspace, id)
    const list = await window.api.stories.list(workspace)
    const cleared = get().selectedId === id
    set({
      stories: list,
      ...(cleared ? { active: null, selectedId: null, activeChapterNumber: null } : {})
    })
  },
  updateChapter: async (workspace, chapterNumber, patch) => {
    const current = get().active
    if (!current) throw new Error('No active story')
    const updated = await window.api.stories.updateChapter(
      workspace,
      current.meta.id,
      chapterNumber,
      patch
    )
    const chapters = current.chapters.map((c) => (c.number === chapterNumber ? updated : c))
    set({ active: { ...current, chapters } })
    return updated
  },
  addChapter: async (workspace) => {
    const current = get().active
    if (!current) return
    const created = await window.api.stories.addChapter(workspace, current.meta.id)
    const reloaded = await window.api.stories.load(workspace, current.meta.id)
    set({ active: reloaded, activeChapterNumber: created.number })
  },
  selectChapter: (chapterNumber) =>
    set({
      activeChapterNumber: chapterNumber,
      streamBuffer: '',
      reasoningBuffer: '',
      generationError: null,
      lastGen: null
    }),

  startContinue: async (workspace, userNote, targetWords) => {
    const current = get().active
    const chapterNumber = get().activeChapterNumber
    if (!current || chapterNumber == null) return
    if (get().generating) return
    const ch = current.chapters.find((c) => c.number === chapterNumber)
    set({
      generating: true,
      streamBuffer: '',
      reasoningBuffer: '',
      generationError: null,
      generationStartedAt: Date.now(),
      pendingGenBefore: ch ? ch.content : ''
    })
    const result = await window.api.generation.continueStream(
      workspace,
      current.meta.id,
      chapterNumber,
      userNote,
      targetWords
    )
    if ('error' in result) {
      set({
        generating: false,
        generationError: result.error,
        generationStreamId: null,
        generationStartedAt: null
      })
      return
    }
    set({ generationStreamId: result.streamId })
  },
  regenerate: async (workspace, userNote) => {
    const lg = get().lastGen
    if (!lg || get().generating) return
    // Restore the chapter to its pre-generation state, then generate again.
    await get().updateChapter(workspace, lg.chapterNumber, { content: lg.before })
    set({
      activeChapterNumber: lg.chapterNumber,
      // Sync the editor draft to the restored content (it's hidden behind the stream overlay anyway).
      externalChapterRevision: get().externalChapterRevision + 1,
      lastGen: null
    })
    await get().startContinue(workspace, userNote)
  },
  cancelContinue: async () => {
    const id = get().generationStreamId
    // Always force-reset local state immediately. Don't wait on the main-process error
    // event — if it's lost (IPC drop, network hang, mismatched streamId) we'd stay stuck.
    // Any later delta/done/error events for this stream are guarded by streamId and
    // become no-ops once we clear it here.
    set({
      generating: false,
      generationStreamId: null,
      generationStartedAt: null,
      streamBuffer: '',
      reasoningBuffer: '',
      pendingGenBefore: null
    })
    if (id) {
      try {
        await window.api.generation.cancel(id)
      } catch {
        // Ignore — the local state is already reset, so the UI is usable either way.
      }
    }
  },

  regenerateImage: async (workspace, chapterNumber, passageText) => {
    const current = get().active
    if (!current) return null
    if (get().imageGenerating) return null
    const text = passageText.trim()
    if (!text) return null
    const storyId = current.meta.id
    const genId = newGenId()
    set({ imageGenerating: true, imageStatus: 'tagging', imageError: null, imageGenId: genId })
    try {
      const result = await window.api.image.generate(genId, workspace, storyId, chapterNumber, text)
      if ('error' in result) {
        if (result.error !== 'aborted') set({ imageError: result.error })
        return null
      }
      return result
    } catch (e) {
      set({ imageError: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      set({ imageGenerating: false, imageStatus: null, imageGenId: null })
    }
  },
  generateImage: async (workspace, chapterNumber, passageText) => {
    const result = await get().regenerateImage(workspace, chapterNumber, passageText)
    if (!result) return
    // Append the image marker at the end of the chapter the passage belongs to.
    const cur = get().active
    const ch = cur?.chapters.find((c) => c.number === chapterNumber)
    if (!cur || !ch) return
    try {
      const marker = imageMarker(result.relPath, result.positive)
      const base = ch.content.replace(/\s+$/, '')
      const newContent = `${base}\n\n${marker}\n`
      const updated = await window.api.stories.updateChapter(
        workspace,
        cur.meta.id,
        chapterNumber,
        {
          content: newContent
        }
      )
      const chapters = cur.chapters.map((c) => (c.number === chapterNumber ? updated : c))
      set({
        active: { ...cur, chapters },
        externalChapterRevision: get().externalChapterRevision + 1
      })
    } catch (e) {
      set({ imageError: e instanceof Error ? e.message : String(e) })
    }
  },
  cancelImage: async () => {
    const id = get().imageGenId
    set({ imageGenerating: false, imageStatus: null, imageGenId: null })
    if (id) {
      try {
        await window.api.image.cancel(id)
      } catch {
        /* local state already reset */
      }
    }
  },

  startOneClick: async (workspace, targetWords) => {
    if (get().oneClickActive || get().generating || get().imageGenerating) return
    const cur0 = get().active
    const chapterNumber = get().activeChapterNumber
    if (!cur0 || chapterNumber == null || !targetWords || targetWords <= 0) return
    const storyId = cur0.meta.id
    const imageEnabled = useSettings.getState().settings?.image.enabled ?? false
    set({
      oneClickActive: true,
      oneClickTarget: targetWords,
      oneClickChunk: 0,
      generationError: null,
      imageError: null
    })
    const MAX_CHUNKS = 60 // safety cap against a runaway loop
    try {
      for (let i = 0; i < MAX_CHUNKS; i++) {
        if (!get().oneClickActive) break
        const act = get().active
        // Bail if the user navigated to a different story/chapter mid-run.
        if (!act || act.meta.id !== storyId || get().activeChapterNumber !== chapterNumber) break
        const before = chapterWordCount(act, chapterNumber)
        if (before >= targetWords) break
        set({ oneClickChunk: i + 1 })

        // 1. Generate one text chunk and wait for it to settle (done or error).
        const settled = new Promise<'done' | 'error'>((resolve) => {
          settleChunk = resolve
        })
        await get().startContinue(workspace, undefined, targetWords)
        if (get().generationStreamId == null) settleActiveChunk('error') // failed to start
        const outcome = await settled
        if (outcome === 'error' || !get().oneClickActive) break

        // 2. Inline image for this chunk (sequential — keeps ordering clean, avoids races).
        if (imageEnabled && get().oneClickActive) {
          const passage = get().lastGeneratedText
          if (passage.trim()) await get().generateImage(workspace, chapterNumber, passage)
        }
        if (!get().oneClickActive) break

        // 3. Stop if the chunk made no progress (empty/refused response).
        if (chapterWordCount(get().active, chapterNumber) <= before) break
      }
    } finally {
      set({ oneClickActive: false, oneClickTarget: null, oneClickChunk: 0 })
    }
  },
  stopOneClick: async () => {
    set({ oneClickActive: false })
    // Unblock the awaited chunk even if the underlying stream event is lost.
    settleActiveChunk('error')
    if (get().generating) await get().cancelContinue()
    if (get().imageGenerating) await get().cancelImage()
  },

  _onStreamDelta: (streamId, delta) => {
    if (streamId !== get().generationStreamId) return
    set({ streamBuffer: get().streamBuffer + delta })
  },
  _onStreamReasoning: (streamId, delta) => {
    if (streamId !== get().generationStreamId) return
    set({ reasoningBuffer: get().reasoningBuffer + delta })
  },
  _onStreamDone: async (workspace, streamId, fullText) => {
    // Top-level guard so ANY thrown error still resets state and unsticks the editor.
    // Without this, an early throw (before the inner try/catch) leaves generating=true
    // and the textarea disabled with no recovery short of restarting the app.
    try {
      if (streamId !== get().generationStreamId) return
      const current = get().active
      const chapterNumber = get().activeChapterNumber
      if (!current || chapterNumber == null) {
        set({
          generating: false,
          generationStreamId: null,
          generationStartedAt: null,
          streamBuffer: '',
          reasoningBuffer: ''
        })
        settleActiveChunk('error')
        return
      }
      const ch = current.chapters.find((c) => c.number === chapterNumber)
      if (!ch) {
        set({
          generating: false,
          generationStreamId: null,
          generationStartedAt: null,
          streamBuffer: '',
          reasoningBuffer: ''
        })
        settleActiveChunk('error')
        return
      }
      const text = (fullText ?? '').trim()
      const before = get().pendingGenBefore ?? ch.content
      const sep = ch.content && !ch.content.endsWith('\n') ? '\n\n' : ''
      const newContent = ch.content + sep + text + '\n'
      try {
        const updated = await window.api.stories.updateChapter(
          workspace,
          current.meta.id,
          chapterNumber,
          { content: newContent }
        )
        const chapters = current.chapters.map((c) => (c.number === chapterNumber ? updated : c))
        set({
          active: { ...current, chapters },
          generating: false,
          generationStreamId: null,
          generationStartedAt: null,
          streamBuffer: '',
          reasoningBuffer: '',
          externalChapterRevision: get().externalChapterRevision + 1,
          pendingGenBefore: null,
          lastGen: { chapterNumber, before, after: newContent },
          lastGeneratedText: text
        })
        // Auto-generate an inline image for the passage just written, if enabled. Skipped
        // during a one-click run — that loop sequences its own image per chunk.
        const image = useSettings.getState().settings?.image
        if (!get().oneClickActive && image?.enabled && image.autoAfterContinue) {
          void get().generateImage(workspace, chapterNumber, text)
        }
        settleActiveChunk('done')
      } catch (e) {
        set({
          generating: false,
          generationStreamId: null,
          generationStartedAt: null,
          streamBuffer: '',
          reasoningBuffer: '',
          generationError: e instanceof Error ? e.message : String(e)
        })
        settleActiveChunk('error')
      }
    } catch (e) {
      // Defensive: any unexpected throw in the body still releases the editor.
      console.error('_onStreamDone outer error:', e)
      set({
        generating: false,
        generationStreamId: null,
        generationStartedAt: null,
        streamBuffer: '',
        reasoningBuffer: '',
        pendingGenBefore: null,
        generationError: e instanceof Error ? e.message : String(e)
      })
      settleActiveChunk('error')
    }
  },
  _onStreamError: (streamId, error) => {
    if (streamId !== get().generationStreamId) return
    set({
      generating: false,
      generationStreamId: null,
      generationStartedAt: null,
      generationError: error === 'aborted' ? null : error,
      // Keep the buffer visible after cancel? Easier reasoning: clear it. The user can re-trigger.
      streamBuffer: '',
      reasoningBuffer: ''
    })
    settleActiveChunk('error')
  },
  _onImageProgress: (genId, phase) => {
    if (genId !== get().imageGenId) return
    set({ imageStatus: phase })
  }
}))
