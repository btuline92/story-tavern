import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { useStories } from '../stores/stories'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import { askChoice, askConfirm, showAlert } from '../stores/dialog'
import { EMPTY_STORY_FILTER, filterStories, isStoryFilterActive } from '../lib/storyFilter'
import { NewStoryDialog } from './NewStoryDialog'
import { DuplicateStoryDialog } from './DuplicateStoryDialog'
import type { StoryMeta } from '../types'
import { StoryDetailsPanel } from './StoryDetailsPanel'
import { StoryReader } from './StoryReader'
import { ChapterDocument } from './ChapterDocument'
import { OutlineSuggestDialog } from './OutlineSuggestDialog'

const IMAGE_MARKER_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

interface ErrorBoundaryProps {
  fallback: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class EditorErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log so DevTools shows the stack
    console.error('Story editor crashed:', error, info.componentStack)
  }
  reset = (): void => this.setState({ error: null })
  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length
}

/**
 * Mechanically turn an outline into Magic Complete beats: every line that starts with a number (e.g.
 * "1.", "2)", "3:") becomes a beat, in the original order. The number/marker is stripped and thrown
 * away (duplicates or out-of-order numbers don't matter); lines without a leading number are ignored.
 */
function parseOutlineBeats(outline: string): string[] {
  const beats: string[] = []
  for (const line of outline.split(/\r?\n/)) {
    const m = /^\s*\d+[.)\]:-]+\s*(\S.*?)\s*$/.exec(line)
    if (m) beats.push(m[1].trim())
  }
  return beats
}

function ElapsedTimer({ since }: { since: number }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [since])
  const secs = Math.max(0, Math.floor((now - since) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <span className="tabular-nums">
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}

function StoryEditor({
  workspace,
  onEnterReader
}: {
  workspace: string
  onEnterReader: () => void
}): React.JSX.Element {
  const {
    active,
    activeChapterNumber,
    generating,
    generationError,
    overrideNotice,
    generationStartedAt,
    streamBuffer,
    reasoningBuffer,
    externalChapterRevision,
    lastGen,
    imageGenerating,
    imageStatus,
    imageError,
    summarizing,
    magicActive,
    magicPlanning,
    magicBeats,
    magicBeatIndex,
    updateChapter,
    addChapter,
    deleteChapter,
    selectChapter,
    startContinue,
    regenerate,
    cancelContinue,
    cancelSummarize,
    generateImage,
    regenerateImage,
    cancelImage,
    startMagicComplete,
    stopMagicComplete,
    remove
  } = useStories()
  const { characters } = useCharacters()
  const imageEnabled = useSettings((s) => s.settings?.image.enabled ?? false)
  const magicAutoStart = useSettings((s) => s.settings?.magicAutoStart ?? true)
  const outlineToBeats = useSettings((s) => s.settings?.outlineToBeats ?? false)
  const settings = useSettings((s) => s.settings)
  const setActiveModelPreset = useSettings((s) => s.setActiveModelPreset)
  const modelPresets = settings?.modelPresets ?? []
  const activeModelPresetId = settings?.activeModelPresetId ?? null
  const [titleDraft, setTitleDraft] = useState('')
  const [outlineDraft, setOutlineDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [userNote, setUserNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false)
  const [copiedText, setCopiedText] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamScrollRef = useRef<HTMLDivElement | null>(null)
  // Tracks which chapter id we've initialized drafts for. Only changes drive a re-init.
  const initializedFor = useRef<string | null>(null)

  const chapter = useMemo(
    () =>
      active && activeChapterNumber != null
        ? (active.chapters.find((c) => c.number === activeChapterNumber) ?? null)
        : null,
    [active, activeChapterNumber]
  )

  // Persisted Magic Complete progress for the active chapter (drives the Resume button).
  const magicTotal = chapter?.magic_beats.length ?? 0
  const magicDone = chapter?.magic_beats_done ?? 0
  const magicResumable = magicTotal > 0 && magicDone < magicTotal

  // Initialize drafts only on (a) chapter switch (id change) or (b) explicit external
  // mutation (Continue appending generated text — signaled by externalChapterRevision
  // bumping in the store). Drafts are user-owned at all other times — never overwritten
  // by store updates, which eliminates the autosave-vs-sync race.
  useEffect(() => {
    if (!chapter) {
      setTitleDraft('')
      setOutlineDraft('')
      setContentDraft('')
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== chapter.id) {
      initializedFor.current = chapter.id
      setTitleDraft(chapter.title)
      setOutlineDraft(chapter.outline)
      setContentDraft(chapter.content)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  // After a Continue completes, the chapter has new content the user expects to see.
  useEffect(() => {
    if (!chapter) return
    setTitleDraft(chapter.title)
    setOutlineDraft(chapter.outline)
    setContentDraft(chapter.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalChapterRevision])

  const dirty = chapter
    ? titleDraft !== chapter.title ||
      outlineDraft !== chapter.outline ||
      contentDraft !== chapter.content
    : false

  const flushSave = async (): Promise<void> => {
    if (!chapter || !dirty) return
    setSaving(true)
    try {
      await updateChapter(workspace, chapter.number, {
        title: titleDraft,
        outline: outlineDraft,
        content: contentDraft
      })
    } finally {
      setSaving(false)
    }
  }

  // Debounced autosave
  useEffect(() => {
    if (!dirty) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      void flushSave()
    }, 1500)
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleDraft, outlineDraft, contentDraft])

  // Auto-scroll the streaming-preview box to the bottom on each new chunk.
  // Must be declared before any early return so hook order stays consistent.
  useEffect(() => {
    if (generating && streamScrollRef.current) {
      streamScrollRef.current.scrollTop = streamScrollRef.current.scrollHeight
    }
  }, [streamBuffer, generating])

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-ink-700">
        Select a story from the list, or start a new one.
      </div>
    )
  }

  const noChapters = active.chapters.length === 0
  const storyCharacters = active.meta.character_ids
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c != null)

  const onContinue = async (): Promise<void> => {
    await flushSave()
    await startContinue(workspace, userNote.trim() || undefined)
  }

  const onCancel = async (): Promise<void> => {
    await cancelContinue()
  }

  const onSwitchModel = async (id: string): Promise<void> => {
    await setActiveModelPreset(workspace, id)
  }

  const busy = generating || summarizing || imageGenerating || magicActive

  const proseTail = (): string => {
    const prose = contentDraft.replace(IMAGE_MARKER_RE, '').trim()
    return prose.slice(-1500)
  }

  // Chapter prose with inline image markers stripped — for the Copy text button.
  const plainChapterText = contentDraft
    .replace(IMAGE_MARKER_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const onCopyText = (): void => {
    if (!plainChapterText) return
    navigator.clipboard
      .writeText(plainChapterText)
      .then(() => {
        setCopiedText(true)
        setTimeout(() => setCopiedText(false), 1500)
      })
      .catch(() => {})
  }

  const onClearChapter = async (): Promise<void> => {
    if (!chapter) return
    const hasContent = contentDraft.trim().length > 0
    const hasBeats = magicTotal > 0
    if (!hasContent && !hasBeats) return
    const beatLabel = `${magicTotal} Magic Complete beat${magicTotal === 1 ? '' : 's'}`

    let clearContent = false
    let clearBeats = false
    if (hasContent && hasBeats) {
      // Both present → let the user keep the beats while clearing the prose (or clear both).
      const choice = await askChoice(
        `Clear this chapter? It has text/images and ${beatLabel}.`,
        [
          { label: 'Clear content only', value: 'content' },
          { label: 'Clear all', value: 'all', style: 'danger' }
        ]
      )
      if (choice == null) return
      clearContent = true
      clearBeats = choice === 'all'
    } else if (hasContent) {
      if (!(await askConfirm('Clear all text and images from this chapter? This cannot be undone.')))
        return
      clearContent = true
    } else {
      if (!(await askConfirm(`Clear this chapter's ${beatLabel}?`))) return
      clearBeats = true
    }

    if (clearContent) setContentDraft('')
    await updateChapter(workspace, chapter.number, {
      ...(clearContent ? { content: '' } : {}),
      // Kept beats lose their written prose, so their progress resets to 0/N.
      ...(clearBeats
        ? { magic_beats: [], magic_beats_done: 0 }
        : clearContent && hasBeats
          ? { magic_beats_done: 0 }
          : {})
    })
  }

  const onGenerateImage = async (): Promise<void> => {
    if (!chapter) return
    await flushSave()
    await generateImage(workspace, chapter.number, proseTail())
  }

  // Mechanically turn the numbered lines of the current outline into Magic Complete beats (no AI).
  const onOutlineToBeats = async (): Promise<void> => {
    if (!chapter) return
    const beats = parseOutlineBeats(outlineDraft)
    if (beats.length === 0) {
      await showAlert(
        'No numbered lines found in the outline. Number the lines you want as beats, e.g.\n\n' +
          '1. They reach the docks at dusk\n2. The handoff goes wrong'
      )
      return
    }
    if (
      magicTotal > 0 &&
      !(await askConfirm(
        `Replace this chapter's ${magicTotal} Magic Complete beat${magicTotal === 1 ? '' : 's'} ` +
          `with ${beats.length} from the outline?`
      ))
    )
      return
    await updateChapter(workspace, chapter.number, { magic_beats: beats, magic_beats_done: 0 })
  }

  // Resume/start writing from where the plan stopped — beats are already planned, prose is kept.
  const onResumeMagic = async (): Promise<void> => {
    if (!chapter) return
    const ok = await askConfirm(
      `Resume Magic Complete from beat ${magicDone + 1} of ${magicTotal}? This writes the remaining beats and locks the editor until it finishes or you press Stop.`
    )
    if (!ok) return
    await flushSave()
    await startMagicComplete(workspace)
  }

  // Run Magic Complete from scratch. If the chapter already has prose/beats (a finished or interrupted
  // run, or hand-written text), clear it first so the fresh plan doesn't append onto the old passages.
  const onStartOver = async (): Promise<void> => {
    if (!chapter) return
    if (!outlineDraft.trim()) {
      await showAlert(
        'Add a chapter outline first. Magic Complete breaks the outline into story beats and writes each one in turn.'
      )
      return
    }
    // With auto-start off, Magic Complete only plans the beats (nothing is written until Resume), so the
    // confirmations describe planning rather than a full write.
    const note = imageEnabled
      ? 'It breaks this chapter’s outline into story beats, then writes each beat as its own passage with an inline image after it.'
      : 'It breaks this chapter’s outline into story beats, then writes each beat as its own passage. Image generation is off, so no images will be added.'
    const hasContent = contentDraft.trim().length > 0 || magicTotal > 0
    const ok = await askConfirm(
      hasContent
        ? magicAutoStart
          ? `Start Magic Complete over?\n\nThis clears this chapter's current text and images, re-plans the outline into new beats, and writes the whole chapter again. This cannot be undone.`
          : `Start Magic Complete over?\n\nThis clears this chapter's current text and images and re-plans the outline into new beats for you to review. Nothing is written until you press Resume. This cannot be undone.`
        : magicAutoStart
          ? `Magic Complete this chapter?\n\n${note}\n\nThis can take a while and locks the editor until it finishes or you press Stop.`
          : `Plan Magic Complete beats for this chapter?\n\nIt breaks the outline into story beats and stops so you can review, edit, and reorder them. Nothing is written until you press Resume.`
    )
    if (!ok) return
    await flushSave()
    if (hasContent) {
      // Wipe prose + old beats so startMagicComplete plans fresh (empty beats ⇒ no resume) and writes
      // into a clean chapter rather than appending after the previous run's passages.
      setContentDraft('')
      await updateChapter(workspace, chapter.number, {
        content: '',
        magic_beats: [],
        magic_beats_done: 0
      })
    }
    await startMagicComplete(workspace)
  }

  const canRegenerate = !!lastGen && lastGen.chapterNumber === activeChapterNumber
  const onRegenerate = async (): Promise<void> => {
    if (!lastGen) return
    if (contentDraft !== lastGen.after) {
      const ok = await askConfirm(
        'Regenerate will discard the last generated passage and try again. Any edits you made to it will be lost. Continue?'
      )
      if (!ok) return
    }
    await regenerate(workspace, userNote.trim() || undefined)
  }

  const onDelete = async (): Promise<void> => {
    if (await askConfirm(`Delete the story "${active.meta.title}" and all its chapters?`)) {
      await remove(workspace, active.meta.id)
    }
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col border-r border-ink-200 bg-ink-50">
        <div className="border-b border-ink-200 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-ink-700">Story</div>
          <div className="font-semibold text-ink-900 truncate" title={active.meta.title}>
            {active.meta.title}
          </div>
          {storyCharacters.length > 0 && (
            <div className="text-xs text-ink-700 truncate mt-0.5">
              with {storyCharacters.map((c) => c.name).join(', ')}
            </div>
          )}
        </div>
        <div className="px-3 py-2 border-b border-ink-200">
          <button
            type="button"
            onClick={() => addChapter(workspace)}
            className="w-full rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs hover:bg-ink-100"
          >
            + Chapter
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {active.chapters.map((c) => (
            <li key={c.id} className="relative group">
              <button
                type="button"
                onClick={() => selectChapter(c.number)}
                className={`block w-full px-3 py-2 pr-8 text-left text-sm ${
                  c.number === activeChapterNumber
                    ? 'bg-ink-100 text-ink-900'
                    : 'text-ink-900 hover:bg-ink-100'
                }`}
              >
                <div className="font-medium truncate">{c.title}</div>
                <div className="text-xs text-ink-700">{wordCount(c.content)} words</div>
              </button>
              {active.chapters.length > 1 && (
                <button
                  type="button"
                  title="Delete chapter"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await askConfirm(
                        `Delete "${c.title}" and all its text? This cannot be undone.`
                      )
                    ) {
                      await deleteChapter(workspace, c.number)
                    }
                  }}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-ink-700 opacity-0 transition hover:bg-danger/15 hover:text-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                  aria-label={`Delete ${c.title}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-ink-200 p-3">
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-md border border-ink-200 px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          >
            Delete story
          </button>
        </div>
      </aside>

      <main className="flex h-full flex-1 flex-col min-w-0 min-h-0">
        <div className="flex items-center gap-3 border-b border-ink-200 bg-surface px-6 py-3">
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={busy}
            placeholder="Chapter title"
            className="flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold focus:outline-none focus:border-ink-200 focus:ring-2 focus:ring-accent-500 disabled:bg-ink-50"
          />
          <div className="text-xs text-ink-700 whitespace-nowrap shrink-0">
            {wordCount(contentDraft)} words {saving ? '• saving…' : dirty ? '• unsaved' : '• saved'}
          </div>
          <button
            type="button"
            onClick={onCopyText}
            disabled={!plainChapterText}
            title="Copy this chapter's text (without images) to the clipboard"
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            {copiedText ? 'Copied!' : 'Copy text'}
          </button>
          <button
            type="button"
            onClick={onClearChapter}
            disabled={busy || (!contentDraft.trim() && magicTotal === 0)}
            title="Delete all text and images in this chapter (keeps the title and outline)"
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={async () => {
              await flushSave()
              onEnterReader()
            }}
            disabled={noChapters}
            title="Open the distraction-free reader"
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            📖 Read
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            title={detailsOpen ? 'Hide story setup' : 'Show story setup'}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            {detailsOpen ? 'Details ▶' : '◀ Details'}
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-6 py-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-700">
            Model
          </span>
          {modelPresets.length > 0 && (
            <select
              value={activeModelPresetId ?? ''}
              onChange={(e) => onSwitchModel(e.target.value)}
              disabled={busy}
              title="Model preset used for generation"
              className="max-w-[12rem] shrink-0 rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:opacity-60"
            >
              {modelPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || '(unnamed)'}
                </option>
              ))}
            </select>
          )}
        </div>

        {!noChapters && (
          <div className="border-b border-ink-200 bg-ink-50 px-6 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-ink-700">
                Chapter outline
                <span className="ml-2 font-normal normal-case text-ink-700/70">
                  (sent to the model — what should happen in this chapter)
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onOutlineToBeats()}
                  disabled={busy || !outlineDraft.trim()}
                  title="Turn each numbered line of the outline into a Magic Complete beat (no AI)"
                  className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-50"
                >
                  ⇢ Outline to beats
                </button>
                <button
                  type="button"
                  onClick={() => setOutlineDialogOpen(true)}
                  disabled={busy}
                  title="Have the LLM suggest possible outlines for this chapter"
                  className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-50"
                >
                  ✨ Suggest outlines
                </button>
              </div>
            </div>
            <textarea
              value={outlineDraft}
              onChange={(e) => setOutlineDraft(e.target.value)}
              disabled={busy}
              rows={3}
              placeholder="A few sentences sketching what should happen here. Leave empty to skip."
              className="w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-100"
            />
          </div>
        )}

        <div className="relative flex-1 overflow-hidden min-h-0">
          {noChapters ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
              <div className="max-w-md">
                <div className="text-ink-900 font-medium mb-2">This story has no chapters yet.</div>
                <div className="text-sm text-ink-700 mb-4">
                  The story was created but the first chapter file is missing — likely a
                  half-finished generation from a previous session. Add a chapter to start writing,
                  or delete the story below.
                </div>
                <button
                  type="button"
                  onClick={() => addChapter(workspace)}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white font-medium hover:bg-accent-600"
                >
                  Add Chapter 1
                </button>
              </div>
            </div>
          ) : (
            <>
              <ChapterDocument
                workspace={workspace}
                storySlug={active.meta.slug}
                value={contentDraft}
                disabled={busy}
                imageEnabled={imageEnabled}
                onChange={setContentDraft}
                onRegenerateImage={(passageText) =>
                  chapter
                    ? regenerateImage(workspace, chapter.number, passageText)
                    : Promise.resolve(null)
                }
                onRewrite={async (passage, instruction) => {
                  if (!chapter) return { error: 'No active chapter.' }
                  // Persist the draft so the rewrite IPC reads current content when locating the passage.
                  await flushSave()
                  const res = await window.api.generation.rewrite(
                    workspace,
                    active.meta.id,
                    chapter.number,
                    passage,
                    instruction
                  )
                  useStories.setState({ overrideNotice: 'notice' in res ? (res.notice ?? null) : null })
                  return res
                }}
              />
              {generating && (
                <div
                  ref={streamScrollRef}
                  className="absolute inset-x-6 bottom-6 top-1/2 overflow-y-auto rounded-lg border border-accent-500 bg-surface shadow-lg p-4 text-base leading-relaxed font-serif"
                >
                  <div className="text-xs uppercase tracking-wide text-accent-600 font-sans mb-2 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                    Streaming
                  </div>
                  {reasoningBuffer && (
                    <details
                      className="mb-3 rounded border border-ink-200 bg-ink-50 px-3 py-2"
                      open
                    >
                      <summary className="cursor-pointer text-xs uppercase tracking-wide text-ink-700 font-sans">
                        Thinking · {reasoningBuffer.length.toLocaleString()} chars
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-ink-700 font-sans italic">
                        {reasoningBuffer}
                      </div>
                    </details>
                  )}
                  {streamBuffer ? (
                    <span className="whitespace-pre-wrap">{streamBuffer}</span>
                  ) : reasoningBuffer ? (
                    <span className="italic text-ink-700 font-sans text-sm">Thinking…</span>
                  ) : (
                    <span className="italic text-ink-700 font-sans text-sm">
                      Waiting for first token…
                    </span>
                  )}
                  <span className="inline-block w-1.5 h-5 ml-1 bg-accent-500 align-middle animate-pulse" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-ink-200 bg-surface px-6 py-3 flex items-center gap-3">
          <input
            type="text"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            disabled={busy}
            placeholder="Author note for this generation (optional, not saved)"
            className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-50"
          />
          {summarizing ? (
            <>
              <div className="flex items-center gap-2 text-xs text-accent-600 whitespace-nowrap">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                Summarizing earlier chapters…
              </div>
              <button
                type="button"
                onClick={() => cancelSummarize()}
                className="rounded-md border border-danger/50 bg-surface px-4 py-2 text-sm text-danger font-medium hover:bg-danger/10"
              >
                Cancel
              </button>
            </>
          ) : magicActive ? (
            <>
              <div className="flex items-center gap-2 text-xs text-accent-600 whitespace-nowrap">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                {magicPlanning
                  ? 'Planning beats…'
                  : `Magic Complete · beat ${magicBeatIndex}/${magicBeats.length}`}
                {!magicPlanning &&
                  (generating
                    ? ' · writing'
                    : imageGenerating
                      ? imageStatus === 'tagging'
                        ? ' · tagging'
                        : imageStatus === 'saving'
                          ? ' · saving image'
                          : ' · image'
                      : '')}
              </div>
              <button
                type="button"
                onClick={() => stopMagicComplete()}
                className="rounded-md border border-danger/50 bg-surface px-4 py-2 text-sm text-danger font-medium hover:bg-danger/10"
              >
                Stop
              </button>
            </>
          ) : generating ? (
            <>
              <div className="text-xs text-ink-700 whitespace-nowrap tabular-nums">
                {streamBuffer.length.toLocaleString()} chars{' '}
                {generationStartedAt != null && (
                  <>
                    • <ElapsedTimer since={generationStartedAt} />
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-danger/50 bg-surface px-4 py-2 text-sm text-danger font-medium hover:bg-danger/10"
              >
                Cancel
              </button>
            </>
          ) : imageGenerating ? (
            <>
              <div className="flex items-center gap-2 text-xs text-accent-600 whitespace-nowrap">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                {imageStatus === 'tagging'
                  ? 'Tagging passage…'
                  : imageStatus === 'generating'
                    ? 'Generating image…'
                    : imageStatus === 'saving'
                      ? 'Saving image…'
                      : 'Working…'}
              </div>
              <button
                type="button"
                onClick={() => cancelImage()}
                className="rounded-md border border-danger/50 bg-surface px-4 py-2 text-sm text-danger font-medium hover:bg-danger/10"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onRegenerate}
                disabled={!canRegenerate}
                title={
                  canRegenerate
                    ? 'Discard the last generated passage and generate again'
                    : 'Generate a passage first, then you can regenerate it'
                }
                className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ⟳ Regenerate
              </button>
              {imageEnabled && (
                <button
                  type="button"
                  onClick={onGenerateImage}
                  title="Generate an inline image for the latest passage"
                  className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-ink-100"
                >
                  🖼 Image
                </button>
              )}
              {magicResumable && (
                <button
                  type="button"
                  onClick={onResumeMagic}
                  title="Resume the interrupted Magic Complete run from where it stopped"
                  className="rounded-md border border-accent-500 px-4 py-2 text-sm font-medium text-accent-600 hover:bg-accent-500/10"
                >
                  ▶ Resume Magic ({magicDone}/{magicTotal})
                </button>
              )}
              <button
                type="button"
                onClick={onStartOver}
                title={
                  magicResumable
                    ? 'Start over: clear this chapter, re-plan the outline into new beats, and write it again'
                    : "Break this chapter's outline into story beats, then write each beat in turn (with an inline image after each)"
                }
                className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-ink-100"
              >
                ✨ Magic Complete
              </button>
              <button
                type="button"
                onClick={onContinue}
                className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white font-medium hover:bg-accent-600"
              >
                Continue ▶
              </button>
            </>
          )}
        </div>

        {overrideNotice && (
          <div
            className="border-t border-accent-500/30 bg-accent-500/10 px-6 py-2 text-sm text-ink-900 whitespace-pre-wrap"
            title="Overrides tab: decision-model checks"
          >
            ⇄ {overrideNotice}
          </div>
        )}
        {generationError && (
          <div className="border-t border-danger/30 bg-danger/12 px-6 py-2 text-sm text-danger whitespace-pre-wrap">
            {generationError}
          </div>
        )}
        {imageError && (
          <div className="border-t border-warning/30 bg-warning/15 px-6 py-2 text-sm text-warning whitespace-pre-wrap">
            Image generation: {imageError}
          </div>
        )}
      </main>

      {detailsOpen && (
        <aside className="w-80 shrink-0 border-l border-ink-200 bg-surface overflow-hidden">
          <StoryDetailsPanel workspace={workspace} />
        </aside>
      )}

      {chapter && (
        <OutlineSuggestDialog
          open={outlineDialogOpen}
          workspace={workspace}
          storyId={active.meta.id}
          chapterNumber={chapter.number}
          onClose={() => setOutlineDialogOpen(false)}
          onApply={(text, beats) => {
            setOutlineDraft(text)
            // Optionally seed Magic Complete beats from the applied outline (settings.outlineToBeats).
            if (outlineToBeats && chapter && beats.length > 0) {
              void updateChapter(workspace, chapter.number, {
                magic_beats: beats,
                magic_beats_done: 0
              })
            }
          }}
        />
      )}
    </div>
  )
}

export function StoriesView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { stories, selectedId, active, loadList, open, closeActive, remove } = useStories()
  const { characters, load: loadChars } = useCharacters()
  const [dialogOpen, setDialogOpen] = useState(false)
  // The story whose Duplicate dialog is open (null = closed).
  const [duplicating, setDuplicating] = useState<StoryMeta | null>(null)
  // Filter the story list to stories whose cast includes this character id ('' = all).
  const [castFilter, setCastFilter] = useState('')
  // Name/tag search + selected tag chips.
  const [filter, setFilter] = useState(EMPTY_STORY_FILTER)
  const [page, setPage] = useState(1)
  // Reader mode (full-window, read-only) is keyed to a story id rather than a bare boolean: the reader
  // shows only while this matches the OPEN story. That makes "open story X straight into the reader"
  // (from the list) race-free — no reset effect fighting the open — and reopening any other story never
  // lands in the reader. Local + ephemeral, like detailsOpen.
  const [readingStoryId, setReadingStoryId] = useState<string | null>(null)
  // Where the reader was opened from, so its back button returns to that screen (list vs editor).
  const [readerFromList, setReaderFromList] = useState(false)

  useEffect(() => {
    loadList(workspace)
    loadChars(workspace)
  }, [workspace])

  const shownStories = useMemo(() => {
    const byCast = castFilter
      ? stories.filter((s) => s.character_ids.includes(castFilter))
      : stories
    return filterStories(byCast, filter)
  }, [stories, castFilter, filter])
  const filtersActive = isStoryFilterActive(filter) || castFilter !== ''
  const clearFilters = (): void => {
    setFilter(EMPTY_STORY_FILTER)
    setCastFilter('')
    setPage(1)
  }
  const PAGE_SIZE = 12
  const totalPages = Math.max(1, Math.ceil(shownStories.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = shownStories.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  // Jump-to-page: clamp a typed page number, else reset the input to the current page.
  const commitPageInput = (el: HTMLInputElement): void => {
    const n = Math.round(Number(el.value))
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
      setPage(n)
      el.value = String(n)
    } else {
      el.value = String(safePage)
    }
  }

  if (active) {
    // Full-window reader replaces the entire editor (its own header + back button).
    if (readingStoryId === active.meta.id) {
      return (
        <StoryReader
          workspace={workspace}
          backLabel={readerFromList ? '← Stories' : '← Editor'}
          onExit={() => {
            setReadingStoryId(null)
            // Return to whichever screen opened the reader: the list closes the story; the editor
            // just drops reader mode and stays on the open story.
            if (readerFromList) closeActive()
          }}
        />
      )
    }
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-ink-200 bg-surface px-4 py-2">
          <button
            type="button"
            onClick={closeActive}
            className="rounded-md border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
          >
            ← Stories
          </button>
          <div className="text-sm text-ink-700 truncate">
            {active.meta.slug ?? '?'}/ · {active.meta.title ?? 'untitled'}
          </div>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <EditorErrorBoundary
            fallback={(error, reset) => (
              <div className="h-full overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto rounded-lg border border-danger/30 bg-danger/12 p-6">
                  <h3 className="text-lg font-semibold text-danger mb-2">
                    Couldn't display this story
                  </h3>
                  <p className="text-sm text-danger mb-3">
                    The editor crashed while rendering "{active.meta.title ?? '(no title)'}". The
                    story file may be corrupted, or a recent change to the schema is incompatible
                    with the saved data.
                  </p>
                  <pre className="text-xs font-mono bg-surface border border-danger/30 rounded p-3 overflow-x-auto mb-4 text-danger">
                    {error.message}
                  </pre>
                  <div className="text-xs text-danger mb-4">
                    The raw file is at <code>{active.meta.slug}/story.md</code> in your workspace.
                    You can edit it directly, or delete the story below.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        closeActive()
                        reset()
                      }}
                      className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm hover:bg-ink-100"
                    >
                      ← Back to list
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          await askConfirm(
                            `Delete "${active.meta.title ?? 'this story'}" and all its files?`
                          )
                        ) {
                          await remove(workspace, active.meta.id)
                          reset()
                        }
                      }}
                      className="rounded-md bg-danger px-3 py-1.5 text-sm text-white font-medium hover:opacity-90"
                    >
                      Delete this story
                    </button>
                  </div>
                </div>
              </div>
            )}
          >
            <StoryEditor
              workspace={workspace}
              onEnterReader={() => {
                setReaderFromList(false)
                setReadingStoryId(active.meta.id)
              }}
            />
          </EditorErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full overflow-y-auto p-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-2xl font-semibold text-ink-900">Stories</h2>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white font-medium hover:bg-accent-600"
            >
              New story…
            </button>
          </div>
          {stories.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={filter.search}
                  onChange={(e) => {
                    setFilter((f) => ({ ...f, search: e.target.value }))
                    setPage(1)
                  }}
                  placeholder="Search stories by name or tag…"
                  className="flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                {characters.length > 0 && (
                  <select
                    value={castFilter}
                    onChange={(e) => {
                      setCastFilter(e.target.value)
                      setPage(1)
                    }}
                    title="Filter stories by a character in the cast"
                    className="rounded-md border border-ink-200 bg-surface px-2 py-2 text-sm"
                  >
                    <option value="">All characters</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {filtersActive && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-md border border-ink-200 bg-surface px-2 py-2 text-sm text-ink-700 hover:bg-ink-100"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
          {stories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-ink-700">
              No stories yet. Click <span className="font-medium">New story…</span> to begin.
            </div>
          ) : shownStories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-ink-700">
              No stories match the current filters.
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {pageItems.map((s) => {
                  const blurb = (s.description || s.premise).trim()
                  const chapters = s.chapterCount ?? 0
                  return (
                    <li key={s.id || s.slug} className="relative group">
                      <button
                        type="button"
                        onClick={() => open(workspace, s.id)}
                        className={`block w-full text-left rounded-lg border bg-surface p-4 pr-10 hover:bg-ink-50 transition ${
                          s.id === selectedId ? 'border-accent-500' : 'border-ink-200'
                        }`}
                      >
                        <div className="font-medium text-ink-900 truncate">{s.title || s.slug}</div>
                        {blurb && (
                          <div className="mt-1 text-sm text-ink-700 line-clamp-2">{blurb}</div>
                        )}
                        {/* Cast avatars could go here later — keeping the row uncrowded for now. */}
                        <div className="mt-2 text-xs text-ink-700">
                          {chapters} {chapters === 1 ? 'chapter' : 'chapters'} · Updated{' '}
                          {new Date(s.updated_at).toLocaleDateString()}
                        </div>
                        {s.tags?.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {s.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        title="Delete story"
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (
                            await askConfirm(`Delete "${s.title || s.slug}" and all its chapters?`)
                          ) {
                            await remove(workspace, s.id)
                          }
                        }}
                        className="absolute top-2 right-2 w-7 h-7 rounded-md text-ink-700 hover:bg-danger/15 hover:text-danger flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition text-lg leading-none"
                        aria-label={`Delete ${s.title}`}
                      >
                        ×
                      </button>
                      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          title="Duplicate this story"
                          onClick={() => setDuplicating(s)}
                          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs font-medium text-ink-900 shadow hover:bg-ink-100"
                        >
                          ⧉ Duplicate
                        </button>
                        {chapters > 0 && (
                          <button
                            type="button"
                            title="Read this story"
                            onClick={async () => {
                              // Open loads the story (chapters + active chapter); then drop straight into
                              // the reader for it. Keyed state means no race with the open.
                              setReaderFromList(true)
                              await open(workspace, s.id)
                              setReadingStoryId(s.id)
                            }}
                            className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-accent-600"
                          >
                            📖 Read
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {shownStories.length > PAGE_SIZE && (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="rounded-md border border-ink-200 bg-surface px-3 py-1 hover:bg-ink-100 disabled:opacity-40"
                  >
                    ‹ Prev
                  </button>
                  <span className="text-ink-700 whitespace-nowrap">
                    Page{' '}
                    <input
                      key={safePage}
                      type="number"
                      min={1}
                      max={totalPages}
                      defaultValue={safePage}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitPageInput(e.currentTarget)
                      }}
                      onBlur={(e) => commitPageInput(e.currentTarget)}
                      aria-label="Jump to page"
                      className="mx-1 w-12 rounded-md border border-ink-200 bg-surface px-1.5 py-1 text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />{' '}
                    of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-md border border-ink-200 bg-surface px-3 py-1 hover:bg-ink-100 disabled:opacity-40"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <NewStoryDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <DuplicateStoryDialog
        story={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicate={async (opts) => {
          if (!duplicating) return
          await window.api.stories.duplicate(workspace, duplicating.id, opts)
          await loadList(workspace)
        }}
      />
    </>
  )
}
