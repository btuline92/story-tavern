import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { useStories } from '../stores/stories'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import { NewStoryDialog } from './NewStoryDialog'
import { StoryDetailsPanel } from './StoryDetailsPanel'
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

function StoryEditor({ workspace }: { workspace: string }): React.JSX.Element {
  const {
    active,
    activeChapterNumber,
    generating,
    generationError,
    generationStartedAt,
    streamBuffer,
    reasoningBuffer,
    externalChapterRevision,
    lastGen,
    imageGenerating,
    imageStatus,
    imageError,
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
    generateImage,
    regenerateImage,
    cancelImage,
    startMagicComplete,
    stopMagicComplete,
    remove
  } = useStories()
  const { characters } = useCharacters()
  const imageEnabled = useSettings((s) => s.settings?.image.enabled ?? false)
  const [titleDraft, setTitleDraft] = useState('')
  const [outlineDraft, setOutlineDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [userNote, setUserNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false)
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

  const busy = generating || imageGenerating || magicActive

  const proseTail = (): string => {
    const prose = contentDraft.replace(IMAGE_MARKER_RE, '').trim()
    return prose.slice(-1500)
  }

  const onGenerateImage = async (): Promise<void> => {
    if (!chapter) return
    await flushSave()
    await generateImage(workspace, chapter.number, proseTail())
  }

  const onMagicComplete = async (): Promise<void> => {
    if (!chapter) return
    if (!outlineDraft.trim()) {
      alert(
        'Add a chapter outline first. Magic Complete breaks the outline into story beats and writes each one in turn.'
      )
      return
    }
    const note = imageEnabled
      ? 'It breaks this chapter’s outline into story beats, then writes each beat as its own passage with an inline image after it.'
      : 'It breaks this chapter’s outline into story beats, then writes each beat as its own passage. Image generation is off, so no images will be added.'
    const ok = confirm(
      `Magic Complete this chapter?\n\n${note}\n\nThis can take a while and locks the editor until it finishes or you press Stop.`
    )
    if (!ok) return
    await flushSave()
    await startMagicComplete(workspace)
  }

  const canRegenerate = !!lastGen && lastGen.chapterNumber === activeChapterNumber
  const onRegenerate = async (): Promise<void> => {
    if (!lastGen) return
    if (contentDraft !== lastGen.after) {
      const ok = confirm(
        'Regenerate will discard the last generated passage and try again. Any edits you made to it will be lost. Continue?'
      )
      if (!ok) return
    }
    await regenerate(workspace, userNote.trim() || undefined)
  }

  const onDelete = async (): Promise<void> => {
    if (confirm(`Delete the story "${active.meta.title}" and all its chapters?`)) {
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
                    if (confirm(`Delete "${c.title}" and all its text? This cannot be undone.`)) {
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
          <div className="text-xs text-ink-700 whitespace-nowrap">
            {wordCount(contentDraft)} words {saving ? '• saving…' : dirty ? '• unsaved' : '• saved'}
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            title={detailsOpen ? 'Hide story setup' : 'Show story setup'}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            {detailsOpen ? 'Details ▶' : '◀ Details'}
          </button>
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
              <button
                type="button"
                onClick={() => setOutlineDialogOpen(true)}
                disabled={busy}
                title="Have the LLM suggest four possible outlines for this chapter"
                className="shrink-0 rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100 disabled:opacity-50"
              >
                ✨ Suggest outlines
              </button>
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
                onChange={setContentDraft}
                onRegenerateImage={(passageText) =>
                  chapter
                    ? regenerateImage(workspace, chapter.number, passageText)
                    : Promise.resolve(null)
                }
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
          {magicActive ? (
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
              <button
                type="button"
                onClick={onMagicComplete}
                title="Break this chapter's outline into story beats, then write each beat in turn (with an inline image after each)"
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
          onApply={(text) => setOutlineDraft(text)}
        />
      )}
    </div>
  )
}

export function StoriesView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { stories, selectedId, active, loadList, open, closeActive, remove } = useStories()
  const { load: loadChars } = useCharacters()
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    loadList(workspace)
    loadChars(workspace)
  }, [workspace])

  if (active) {
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
                          confirm(
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
            <StoryEditor workspace={workspace} />
          </EditorErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-ink-900">Stories</h2>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white font-medium hover:bg-accent-600"
          >
            New story…
          </button>
        </div>
        {stories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-ink-700">
            No stories yet. Click <span className="font-medium">New story…</span> to begin.
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {stories.map((s) => (
              <li key={s.id || s.slug} className="relative group">
                <button
                  type="button"
                  onClick={() => open(workspace, s.id)}
                  className={`block w-full text-left rounded-lg border bg-surface p-4 pr-10 hover:bg-ink-50 transition ${
                    s.id === selectedId ? 'border-accent-500' : 'border-ink-200'
                  }`}
                >
                  <div className="font-medium text-ink-900 truncate">{s.title || s.slug}</div>
                  <div className="text-xs text-ink-700 mt-1">
                    Updated {new Date(s.updated_at).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  title="Delete story"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${s.title || s.slug}" and all its chapters?`)) {
                      await remove(workspace, s.id)
                    }
                  }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-md text-ink-700 hover:bg-danger/15 hover:text-danger flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition text-lg leading-none"
                  aria-label={`Delete ${s.title}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewStoryDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}
