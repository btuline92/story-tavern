import { useEffect, useState } from 'react'
import type { StoryMeta } from '../types'

export interface DuplicateOptions {
  title: string
  characters: boolean
  plugins: boolean
  lorebooks: boolean
  preset: boolean
  premise: boolean
  details: boolean
  chapters: boolean
  firstChapterOnly: boolean
  content: boolean
  beats: boolean
  summary: boolean
}

type Flag = Exclude<keyof DuplicateOptions, 'title'>

interface Props {
  /** The story to duplicate; null = closed. */
  story: StoryMeta | null
  onClose: () => void
  onDuplicate: (opts: DuplicateOptions) => Promise<void>
}

function defaults(story: StoryMeta): DuplicateOptions {
  return {
    title: `${story.title} (copy)`,
    characters: true,
    plugins: true,
    lorebooks: true,
    preset: true,
    premise: true,
    details: true,
    chapters: true,
    firstChapterOnly: false,
    content: true,
    beats: true,
    summary: true
  }
}

export function DuplicateStoryDialog({
  story,
  onClose,
  onDuplicate
}: Props): React.JSX.Element | null {
  const [opts, setOpts] = useState<DuplicateOptions | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Reset to defaults each time the dialog opens for a story.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpts(story ? defaults(story) : null)
    setError(null)
    setBusy(false)
  }, [story])

  if (!story || !opts) return null

  // Dependencies: chapter-level parts need chapters; the summary describes ALL chapters' prose, so it's
  // only valid when every chapter is copied with its content.
  const enabled: Record<Flag, boolean> = {
    characters: true,
    plugins: true,
    lorebooks: true,
    preset: true,
    premise: true,
    details: true,
    chapters: true,
    firstChapterOnly: opts.chapters,
    content: opts.chapters,
    beats: opts.chapters,
    summary: opts.chapters && opts.content && !opts.firstChapterOnly
  }
  const on = (f: Flag): boolean => enabled[f] && opts[f]
  const toggle = (f: Flag): void => setOpts({ ...opts, [f]: !opts[f] })

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // Send the *effective* values so grayed-out options are never applied.
      const effective = { ...opts } as DuplicateOptions
      for (const f of Object.keys(enabled) as Flag[]) effective[f] = on(f)
      await onDuplicate(effective)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const box = ({
    flag,
    label,
    hint,
    indent
  }: {
    flag: Flag
    label: string
    hint?: string
    indent?: boolean
  }): React.JSX.Element => (
    <label
      className={`flex items-start gap-2 py-1 ${indent ? 'ml-6' : ''} ${
        enabled[flag] ? 'cursor-pointer text-ink-900' : 'cursor-not-allowed text-ink-700 opacity-50'
      }`}
    >
      <input
        type="checkbox"
        checked={on(flag)}
        disabled={!enabled[flag] || busy}
        onChange={() => toggle(flag)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
      />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-ink-700">{hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex w-[30rem] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-xl">
        <div className="border-b border-ink-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-ink-900">Duplicate story</h3>
          <p className="mt-1 text-sm text-ink-700">
            Choose what to copy from “{story.title}” into a new story.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
            New title
          </label>
          <input
            type="text"
            value={opts.title}
            onChange={(e) => setOpts({ ...opts, title: e.target.value })}
            disabled={busy}
            className="mb-4 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
          />

          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-700">
            Story setup
          </div>
          {box({ flag: 'characters', label: 'Characters (cast)' })}
          {box({ flag: 'premise', label: 'Premise' })}
          {box({ flag: 'details', label: 'Description & tags' })}
          {box({ flag: 'preset', label: 'Preset' })}
          {box({ flag: 'plugins', label: 'Plugins' })}
          {box({ flag: 'lorebooks', label: 'Lorebooks' })}

          <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-700">
            Chapters
          </div>
          {box({
            flag: 'chapters',
            label: 'Chapters',
            hint: 'Titles and outlines. Off = the copy starts with one empty chapter.'
          })}
          {box({ flag: 'firstChapterOnly', label: 'Only copy the first chapter', indent: true })}
          {box({
            flag: 'content',
            label: 'Chapter content',
            hint: 'Prose and inline images.',
            indent: true
          })}
          {box({ flag: 'beats', label: 'Magic Complete beats', indent: true })}
          {box({
            flag: 'summary',
            label: 'Story summary',
            hint: 'Needs every chapter copied with its content.',
            indent: true
          })}
          {error && <div className="mt-3 text-sm text-danger whitespace-pre-wrap">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !opts.title.trim()}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {busy ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  )
}
