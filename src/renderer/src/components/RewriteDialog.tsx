import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  /** The highlighted passage being rewritten. */
  passage: string
  onGenerate: (
    passage: string,
    instruction: string
  ) => Promise<{ text: string } | { error: string }>
  onAccept: (text: string) => void
  onClose: () => void
}

export function RewriteDialog({
  open,
  passage,
  onGenerate,
  onAccept,
  onClose
}: Props): React.JSX.Element | null {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // Reset dialog state each time it opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstruction('')
      setLoading(false)
      setError(null)
      setResult(null)
    }
  }, [open])

  if (!open) return null

  const generate = async (): Promise<void> => {
    if (!instruction.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await onGenerate(passage, instruction.trim())
      if ('error' in res) {
        setError(res.error)
        return
      }
      setResult(res.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const accept = (): void => {
    if (result == null) return
    onAccept(result)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex w-[46rem] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-xl">
        <div className="border-b border-ink-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-ink-900">Rewrite passage</h3>
          <p className="mt-1 text-sm text-ink-700">
            Tell the model how to change the selected text. It sees the story so far, so instructions
            like “make it a little more tense” work. Preview, then Accept to replace the selection.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-700">
            Selected passage
          </div>
          <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 p-2 text-sm text-ink-700 font-serif">
            {passage}
          </div>

          <label className="mt-4 mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
            Instruction
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            disabled={loading}
            placeholder="e.g. make it a little more tense; tighten it up; add sensory detail"
            className="w-full resize-y rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-50"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={loading || !instruction.trim()}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {loading ? 'Rewriting…' : result != null ? '↻ Regenerate' : '✨ Rewrite'}
            </button>
            {loading && (
              <span className="flex items-center gap-2 text-xs text-accent-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-500" />
                Rewriting the passage…
              </span>
            )}
          </div>
          {error && <div className="mt-3 text-sm text-danger whitespace-pre-wrap">{error}</div>}

          {result != null && (
            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                Rewrite
              </div>
              <div className="mt-1 whitespace-pre-wrap rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-900 font-serif">
                {result}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={result == null || loading}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
