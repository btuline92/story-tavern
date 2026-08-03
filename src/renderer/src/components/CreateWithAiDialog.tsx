import { useEffect, useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useCharacters } from '../stores/characters'
import type { GeneratedCharacter } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

function PreviewBlock({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element | null {
  if (!value.trim()) return null
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-700">{label}</div>
      <div
        className={`mt-1 whitespace-pre-wrap text-sm text-ink-900 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

export function CreateWithAiDialog({ open, onClose }: Props): React.JSX.Element | null {
  const workspace = useWorkspace((s) => s.path)!
  const createFromAI = useCharacters((s) => s.createFromAI)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [using, setUsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedCharacter | null>(null)

  useEffect(() => {
    if (open) {
      // Reset all dialog state each time it opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrompt('')
      setLoading(false)
      setUsing(false)
      setError(null)
      setGenerated(null)
    }
  }, [open])

  if (!open) return null

  const busy = loading || using

  const generate = async (): Promise<void> => {
    if (!prompt.trim() || busy) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.generation.createCharacter(workspace, prompt.trim())
      if ('error' in result) {
        setError(result.error)
        return
      }
      setGenerated(result.character)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const useThis = async (): Promise<void> => {
    if (!generated || busy) return
    setUsing(true)
    try {
      await createFromAI(workspace, generated)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUsing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex w-[46rem] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-xl">
        <div className="border-b border-ink-200 px-6 py-4">
          <h3 className="text-xl font-semibold text-ink-900">Create character with AI</h3>
          <p className="mt-1 text-sm text-ink-700">
            Describe a character and the model fills the card. Preview it, then Use this to open it
            in the editor for final tweaks.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
            Describe the character
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={busy}
            placeholder="e.g. A jaded elven ranger who distrusts magic — gruff but secretly kind, haunted by a burned village."
            className="w-full resize-y rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-50"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={busy || !prompt.trim()}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {loading ? 'Generating…' : generated ? '↻ Regenerate' : '✨ Generate'}
            </button>
            {loading && (
              <span className="flex items-center gap-2 text-xs text-accent-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent-500" />
                Designing the character…
              </span>
            )}
          </div>
          {error && <div className="mt-3 text-sm text-danger whitespace-pre-wrap">{error}</div>}

          {generated && (
            <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50 p-4">
              <div className="text-lg font-semibold text-ink-900">
                {generated.name || '(unnamed)'}
              </div>
              {generated.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {generated.tags.map((t, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <PreviewBlock label="Description" value={generated.description} />
              <PreviewBlock label="Personality" value={generated.personality} />
              <PreviewBlock label="Scenario" value={generated.scenario} />
              <PreviewBlock label="First message" value={generated.first_mes} />
              <PreviewBlock label="Appearance tags" value={generated.appearance_tags} mono />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={using}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={useThis}
            disabled={!generated || busy}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {using ? 'Creating…' : 'Use this'}
          </button>
        </div>
      </div>
    </div>
  )
}
