import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  workspace: string
  storyId: string
  chapterNumber: number
  onClose: () => void
  /** Apply the chosen outline text to the chapter's outline field. */
  onApply: (outlineText: string) => void
}

/** Format an outline's beats as a numbered, one-per-line block for the outline textarea. */
function formatOutline(beats: string[]): string {
  return beats.map((b, i) => `${i + 1}. ${b}`).join('\n')
}

export function OutlineSuggestDialog({
  open,
  workspace,
  storyId,
  chapterNumber,
  onClose,
  onApply
}: Props): React.JSX.Element | null {
  const [guidance, setGuidance] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outlines, setOutlines] = useState<string[][]>([])

  useEffect(() => {
    if (open) {
      setGuidance('')
      setError(null)
      setOutlines([])
      setLoading(false)
    }
  }, [open])

  if (!open) return null

  const generate = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.generation.suggestOutlines(
        workspace,
        storyId,
        chapterNumber,
        guidance.trim() || undefined
      )
      if ('error' in result) {
        setError(result.error)
        return
      }
      if (result.outlines.length === 0) {
        setError('No outlines were produced. Try again, or add a bit of guidance.')
        return
      }
      setOutlines(result.outlines)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex w-[52rem] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-xl">
        <div className="border-b border-ink-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-ink-900">Suggest chapter outline</h3>
          <p className="mt-1 text-sm text-ink-700">
            Generates four possible outlines, each about 8 beats. Pick one to fill the chapter
            outline — you can edit it afterward.
          </p>
        </div>

        <div className="border-b border-ink-200 px-6 py-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
            Guidance (optional)
          </label>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={2}
            disabled={loading}
            placeholder="A really rough idea to steer the outlines — e.g. 'they finally confront the smuggler, and it goes wrong'. Leave blank to let the model run free."
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-50"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {loading ? 'Generating…' : outlines.length > 0 ? '↻ Regenerate' : '✨ Generate outlines'}
            </button>
            {loading && (
              <span className="flex items-center gap-2 text-xs text-accent-600">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                Thinking up four directions…
              </span>
            )}
          </div>
          {error && <div className="mt-3 text-sm text-danger whitespace-pre-wrap">{error}</div>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {outlines.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-center text-sm text-ink-700">
              {loading
                ? 'Generating four candidate outlines…'
                : 'Press Generate to get four candidate outlines.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {outlines.map((beats, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-lg border border-ink-200 bg-ink-50 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-ink-900">Option {i + 1}</div>
                    <button
                      type="button"
                      onClick={() => {
                        onApply(formatOutline(beats))
                        onClose()
                      }}
                      className="rounded-md bg-accent-500 px-3 py-1 text-xs font-medium text-white hover:bg-accent-600"
                    >
                      Use this
                    </button>
                  </div>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-900 marker:text-ink-700">
                    {beats.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
