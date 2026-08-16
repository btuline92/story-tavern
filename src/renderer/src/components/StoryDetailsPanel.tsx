import { useEffect, useRef, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { usePresets } from '../stores/presets'
import { usePlugins } from '../stores/plugins'
import { useSettings } from '../stores/settings'
import { useStories } from '../stores/stories'
import { askConfirm } from '../stores/dialog'
import { CharacterPicker } from './CharacterPicker'
import { TagsEditor } from './TagsEditor'

interface DraftMeta {
  title: string
  description: string
  tags: string[]
  characterIds: string[]
  presetId: string | null
  pluginIds: string[]
  premise: string
}

interface Props {
  workspace: string
}

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: SectionProps): React.JSX.Element {
  return (
    <details open={defaultOpen} className="border-b border-ink-200 group">
      <summary className="flex items-center justify-between cursor-pointer select-none px-4 py-3 hover:bg-ink-50">
        <span className="text-sm font-semibold text-ink-900">{title}</span>
        <span className="text-ink-700 text-xs transition-transform group-open:rotate-90">▶</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
      {children}
    </label>
  )
}

const BTN_SECONDARY =
  'rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50'
const BTN_PRIMARY =
  'rounded-md bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50'
const BTN_DANGER =
  'rounded-md border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50'

/**
 * View / edit / delete / regenerate the story's running summary. The summarizer normally folds old
 * chapters in automatically, but retroactively editing an already-folded chapter leaves the summary
 * stale — so this gives a manual escape hatch to fix or rebuild it.
 */
function SummaryEditor({ workspace }: { workspace: string }): React.JSX.Element | null {
  const { active, summarizing, updateMeta, regenerateSummary, cancelSummarize } = useStories()
  const summarizer = useSettings((s) => s.settings?.summarizer)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!active) return null

  const summary = active.meta.summary ?? ''
  const through = active.meta.summary_through_chapter
  const hasSummary = summary.trim().length > 0
  const canRegen = !!summarizer?.enabled
  const threshold = summarizer ? summarizer.minChapters + summarizer.batchSize : null

  const startEdit = (): void => {
    setText(summary)
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await updateMeta(workspace, active.meta.id, { summary: text })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const del = async (): Promise<void> => {
    const ok = await askConfirm(
      'Delete the story summary? Earlier chapters will be sent to the model in full again until the summarizer re-runs.'
    )
    if (!ok) return
    setBusy(true)
    try {
      await updateMeta(workspace, active.meta.id, { summary: '', summaryThroughChapter: null })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (): Promise<void> => {
    const ok = await askConfirm(
      hasSummary
        ? 'Regenerate the summary from scratch? This wipes the current summary and re-summarizes earlier chapters with the model.'
        : 'Generate a summary of the earlier chapters now?'
    )
    if (!ok) return
    await regenerateSummary(workspace)
  }

  return (
    <div className="space-y-2">
      {editing ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y font-serif"
          />
          <div className="text-xs text-ink-700">
            Editing changes the text only — it still covers{' '}
            {through ? `up to chapter ${through}` : 'no chapters yet'}.
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className={BTN_SECONDARY}
            >
              Cancel
            </button>
          </div>
        </>
      ) : hasSummary ? (
        <>
          <div className="text-xs text-ink-700">
            {through ? `Covers up to chapter ${through}. ` : ''}
            The model sees this in place of the earlier chapters&apos; full text.
          </div>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 p-3 text-sm text-ink-900 font-serif">
            {summary}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startEdit}
              disabled={summarizing || busy}
              className={BTN_SECONDARY}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={summarizing || busy || !canRegen}
              className={BTN_SECONDARY}
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => void del()}
              disabled={summarizing || busy}
              className={BTN_DANGER}
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-ink-700">
            No summary yet.{' '}
            {threshold != null
              ? `Once there are more than ${threshold} chapters, the summarizer condenses the oldest ones so the model keeps a compact “story so far.” `
              : ''}
            You can also build it now.
          </div>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={summarizing || busy || !canRegen}
            className={BTN_PRIMARY}
          >
            Generate
          </button>
        </>
      )}

      {!canRegen && (
        <div className="text-xs text-ink-700">
          Enable the summarizer in Settings to {hasSummary ? 'regenerate' : 'generate'} it.
        </div>
      )}

      {summarizing && (
        <div className="flex items-center gap-2 text-xs text-accent-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-500" />
          Summarizing…
          <button
            type="button"
            onClick={() => void cancelSummarize()}
            className="rounded border border-ink-200 px-2 py-0.5 text-ink-900 hover:bg-ink-100"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export function StoryDetailsPanel({ workspace }: Props): React.JSX.Element | null {
  const { active, activeChapterNumber, magicActive, magicBeatIndex, updateMeta, updateChapter } =
    useStories()
  const { characters, load: loadChars } = useCharacters()
  const { presets, load: loadPresets } = usePresets()
  const { plugins, load: loadPlugins } = usePlugins()

  const [draft, setDraft] = useState<DraftMeta | null>(null)
  const [saving, setSaving] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks which story id we've initialized drafts for. Only changes drive a re-init.
  const initializedFor = useRef<string | null>(null)
  // Inline beat editing in the Magic Complete tile view (index into the active chapter's beats).
  const [editingBeat, setEditingBeat] = useState<number | null>(null)
  const [beatDraft, setBeatDraft] = useState('')
  // Manual "add a beat by hand" editor (appends to the plan; reorder then slots it into place).
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState('')

  useEffect(() => {
    loadChars(workspace)
    loadPresets(workspace)
    loadPlugins(workspace)
  }, [workspace])

  // Drop any in-progress beat edit/add when the active chapter changes (the index would point elsewhere).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingBeat(null)
    setAdding(false)
  }, [activeChapterNumber])

  // Initialize drafts ONLY when the active story id changes (or active goes null).
  // After init, drafts are entirely user-owned — we never sync from active.meta again.
  // This eliminates the autosave-vs-sync race that has bitten us repeatedly.
  useEffect(() => {
    if (!active) {
      setDraft(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== active.meta.id) {
      initializedFor.current = active.meta.id
      setDraft({
        title: active.meta.title,
        description: active.meta.description,
        tags: active.meta.tags ?? [],
        characterIds: active.meta.character_ids,
        presetId: active.meta.preset_id,
        pluginIds: active.meta.plugin_ids,
        premise: active.meta.premise
      })
    }
  }, [active?.meta.id])

  const dirty =
    !!active &&
    !!draft &&
    (draft.title !== active.meta.title ||
      draft.description !== active.meta.description ||
      JSON.stringify(draft.tags) !== JSON.stringify(active.meta.tags) ||
      JSON.stringify(draft.characterIds) !== JSON.stringify(active.meta.character_ids) ||
      draft.presetId !== active.meta.preset_id ||
      JSON.stringify(draft.pluginIds) !== JSON.stringify(active.meta.plugin_ids) ||
      draft.premise !== active.meta.premise)

  // Debounced autosave: drafts are the source of truth; flow is one-way to disk.
  useEffect(() => {
    if (!dirty || !active || !draft) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      void (async () => {
        setSaving(true)
        try {
          await updateMeta(workspace, active.meta.id, {
            title: draft.title,
            description: draft.description,
            tags: draft.tags,
            characterIds: draft.characterIds,
            presetId: draft.presetId,
            pluginIds: draft.pluginIds,
            premise: draft.premise
          })
        } finally {
          setSaving(false)
        }
      })()
    }, 1500)
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dirty,
    draft?.title,
    draft?.description,
    draft?.tags,
    draft?.characterIds,
    draft?.presetId,
    draft?.pluginIds,
    draft?.premise
  ])

  if (!active || !draft) return null

  const setField = <K extends keyof DraftMeta>(key: K, value: DraftMeta[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  // Active chapter's persisted Magic Complete beats + progress (for the inspection section below).
  const activeChapter =
    activeChapterNumber != null
      ? (active.chapters.find((c) => c.number === activeChapterNumber) ?? null)
      : null
  const beats = activeChapter?.magic_beats ?? []
  const beatsDone = activeChapter?.magic_beats_done ?? 0
  // The beat currently being written during a live run (1-based); else the completed count.
  const currentBeat = magicActive ? magicBeatIndex : beatsDone

  // Partial reset: mark this beat (and everything after) as not-yet-written so Resume rewrites from
  // here. Deliberately leaves the prose alone — which text came from which beat isn't tracked, so
  // removing the now-stale passages is left to the user.
  const resetToBeat = async (i: number): Promise<void> => {
    if (!activeChapter || magicActive) return
    const ok = await askConfirm(
      `Set Magic Complete back to beat ${i + 1}? Resume will rewrite from beat ${i + 1} onward.\n\n` +
        `The passages already written for beats ${i + 1}–${beatsDone} stay in the chapter — delete ` +
        `those yourself first if you don't want duplicates.`
    )
    if (!ok) return
    await updateChapter(workspace, activeChapter.number, { magic_beats_done: i })
  }

  const startEditBeat = (i: number): void => {
    setEditingBeat(i)
    setBeatDraft(beats[i])
  }

  const saveBeat = async (): Promise<void> => {
    if (editingBeat == null || !activeChapter) return
    const idx = editingBeat
    const text = beatDraft.trim()
    setEditingBeat(null)
    if (!text || text === beats[idx]) return
    const next = [...beats]
    next[idx] = text
    await updateChapter(workspace, activeChapter.number, { magic_beats: next })
  }

  // Append a hand-written beat (skip planning from the outline, or add a piece to an existing plan).
  const addBeat = async (): Promise<void> => {
    const text = addDraft.trim()
    setAdding(false)
    setAddDraft('')
    if (!text || !activeChapter) return
    await updateChapter(workspace, activeChapter.number, { magic_beats: [...beats, text] })
  }

  // Swap a beat with its neighbor. Unrestricted (including across written beats) so a new beat can be
  // slotted between older steps; magic_beats_done is a raw front-count and doesn't move the prose.
  const moveBeat = async (from: number, to: number): Promise<void> => {
    if (!activeChapter || magicActive || to < 0 || to >= beats.length || from === to) return
    const next = [...beats]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    await updateChapter(workspace, activeChapter.number, { magic_beats: next })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 bg-surface px-4 py-3">
        <div className="text-sm font-semibold text-ink-900">Story setup</div>
        <div className="text-xs text-ink-700">
          {saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Core">
          <div>
            <Label>Title</Label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setField('title', e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <div className="text-xs text-ink-700 mt-1">
              Renaming will move the story folder on save.
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              placeholder="A short blurb shown in the story list. Seeded from the premise; edit freely."
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
            />
          </div>
          <TagsEditor value={draft.tags} onChange={(v) => setField('tags', v)} />
          <div>
            <Label>Characters</Label>
            <CharacterPicker
              characters={characters}
              selectedIds={draft.characterIds}
              heightClass="max-h-60"
              filterable
              onToggle={(id) =>
                setField(
                  'characterIds',
                  draft.characterIds.includes(id)
                    ? draft.characterIds.filter((x) => x !== id)
                    : [...draft.characterIds, id]
                )
              }
            />
            <div className="text-xs text-ink-700 mt-1">
              All selected characters are sent to story generation and the image tagger.
            </div>
          </div>
          <div>
            <Label>Preset</Label>
            <select
              value={draft.presetId ?? ''}
              onChange={(e) => setField('presetId', e.target.value || null)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm bg-surface"
            >
              <option value="">— Workspace default —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="text-xs text-ink-700 mt-1">
              Which prompt preset to use for this story. Falls back to the workspace active preset,
              then a built-in default.
            </div>
          </div>
        </Section>

        <Section title="Plugins" defaultOpen={false}>
          {plugins.length === 0 ? (
            <div className="text-xs text-ink-700">
              No plugins yet. Create reusable system-prompt decorators in the Plugins tab.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-md border border-ink-200">
              {plugins.map((p) => (
                <label
                  key={p.id}
                  className="flex items-start gap-2 px-3 py-1.5 hover:bg-ink-100 cursor-pointer border-b border-ink-100 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={draft.pluginIds.includes(p.id)}
                    onChange={() =>
                      setField(
                        'pluginIds',
                        draft.pluginIds.includes(p.id)
                          ? draft.pluginIds.filter((x) => x !== p.id)
                          : [...draft.pluginIds, p.id]
                      )
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-900">{p.name}</div>
                    <div className="truncate text-xs text-ink-700">
                      {p.content.trim().slice(0, 60) || 'Empty'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="text-xs text-ink-700 mt-1">
            Enabled plugins are appended to the end of the system prompt for this story.
          </div>
        </Section>

        <Section title="Premise">
          <div>
            <Label>Story premise</Label>
            <textarea
              value={draft.premise}
              onChange={(e) => setField('premise', e.target.value)}
              rows={10}
              placeholder="What is this story about? Set the situation, stakes, mood, and any constraints. This goes into the system prompt at generation time."
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
            />
          </div>
        </Section>

        <Section title="Summary" defaultOpen={false}>
          <SummaryEditor workspace={workspace} />
        </Section>

        <Section title="Magic Complete" defaultOpen={beats.length > 0}>
          {beats.length === 0 ? (
            <div className="text-xs text-ink-700">
              No beats yet. Run Magic Complete on a chapter to plan them from the outline, or build a
              plan by hand with ＋ Add beat below. An interrupted run can be resumed.
            </div>
          ) : (
            <>
              <div className="text-xs text-ink-700">
                Beat {Math.min(currentBeat, beats.length)} / {beats.length}
                {magicActive ? ' · writing…' : beatsDone >= beats.length ? ' · done' : ' · paused'}
              </div>
              {!magicActive && (
                <div className="text-xs text-ink-700">
                  ✎ edit · ▲▼ reorder · ↺ set the run back to a written beat. Reordering changes the
                  plan only — it doesn&apos;t move the prose already written, so tidy that yourself.
                </div>
              )}
              <ol className="space-y-1">
                {beats.map((beat, i) => {
                  const done = i < beatsDone
                  const writing = magicActive && i === magicBeatIndex - 1
                  const editing = editingBeat === i
                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        writing
                          ? 'border-accent-500 bg-accent-500/10 text-ink-900'
                          : done
                            ? 'border-ink-200 bg-ink-50 text-ink-700'
                            : 'border-dashed border-ink-200 text-ink-700'
                      }`}
                    >
                      {editing ? (
                        <div className="min-w-0 flex-1 space-y-1">
                          <textarea
                            value={beatDraft}
                            onChange={(e) => setBeatDraft(e.target.value)}
                            rows={3}
                            className="w-full resize-y rounded border border-ink-200 px-2 py-1 text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => void saveBeat()}
                              className="rounded bg-accent-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-accent-600"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingBeat(null)}
                              className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="shrink-0 tabular-nums">
                            {writing ? '▶' : done ? '✓' : `${i + 1}.`}
                          </span>
                          <span className="min-w-0 flex-1">{beat}</span>
                          {!magicActive && (
                            <span className="shrink-0 flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => void moveBeat(i, i - 1)}
                                disabled={i === 0}
                                title="Move beat up"
                                className="rounded px-1 leading-none text-ink-700 hover:bg-ink-100 disabled:opacity-30"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => void moveBeat(i, i + 1)}
                                disabled={i === beats.length - 1}
                                title="Move beat down"
                                className="rounded px-1 leading-none text-ink-700 hover:bg-ink-100 disabled:opacity-30"
                              >
                                ▼
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditBeat(i)}
                                title="Edit this beat"
                                className="rounded px-1 leading-none text-ink-700 hover:bg-ink-100"
                              >
                                ✎
                              </button>
                              {done && (
                                <button
                                  type="button"
                                  onClick={() => void resetToBeat(i)}
                                  title={`Set the run back to beat ${i + 1} (Resume rewrites from here)`}
                                  className="rounded px-1 leading-none text-ink-700 hover:bg-ink-100"
                                >
                                  ↺
                                </button>
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ol>
            </>
          )}

          {!magicActive &&
            (adding ? (
              <div className="mt-2 space-y-1 rounded-md border border-dashed border-ink-200 px-2 py-1.5">
                <textarea
                  value={addDraft}
                  onChange={(e) => setAddDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Describe the beat to add — it's appended to the end; use ▲ to move it into place."
                  className="w-full resize-y rounded border border-ink-200 px-2 py-1 text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void addBeat()}
                    disabled={!addDraft.trim()}
                    className="rounded bg-accent-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false)
                      setAddDraft('')
                    }}
                    className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddDraft('')
                  setAdding(true)
                }}
                className="mt-2 w-full rounded-md border border-dashed border-ink-200 px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
              >
                ＋ Add beat
              </button>
            ))}
        </Section>

        {/*
          Add more sections here as the story-config schema grows:
            <Section title="Style" defaultOpen={false}>...</Section>
            <Section title="Plot" defaultOpen={false}>...</Section>
            <Section title="Worldbuilding" defaultOpen={false}>...</Section>
            <Section title="Generation overrides" defaultOpen={false}>...</Section>
        */}
      </div>
    </div>
  )
}
