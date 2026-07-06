import { useEffect, useState } from 'react'

const KNOWN_PLACEHOLDERS = [
  'prompt',
  'negative_prompt',
  'model',
  'vae',
  'sampler',
  'scheduler',
  'steps',
  'scale',
  'cfg',
  'width',
  'height',
  'seed',
  'denoise',
  'clip_skip'
]

interface Props {
  workspace: string
  initialName: string
  onClose: () => void
  onSaved: (name: string) => void | Promise<void>
}

export function WorkflowEditor({
  workspace,
  initialName,
  onClose,
  onSaved
}: Props): React.JSX.Element {
  const [name, setName] = useState(initialName || 'Workflow.json')
  const [json, setJson] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.comfy
      .getWorkflow(workspace, initialName)
      .then((text) => {
        if (!cancelled) setJson(text)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspace, initialName])

  const validJson = ((): boolean => {
    try {
      JSON.parse(json)
      return true
    } catch {
      return false
    }
  })()

  const onSave = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await window.api.comfy.saveWorkflow(workspace, name.trim(), json)
      await onSaved(name.trim().endsWith('.json') ? name.trim() : `${name.trim()}.json`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-full max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-ink-200 bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div className="font-medium text-ink-900">Edit ComfyUI workflow</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-ink-700 hover:bg-ink-100"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
              Filename
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
              Placeholders (green = present in this workflow)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_PLACEHOLDERS.map((p) => {
                const present = json.includes(`%${p}%`)
                return (
                  <span
                    key={p}
                    className={`rounded-full px-2 py-0.5 text-xs font-mono ${
                      present ? 'bg-green-100 text-green-800' : 'bg-ink-100 text-ink-700'
                    }`}
                  >
                    %{p}%
                  </span>
                )
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
              Workflow JSON{' '}
              {!validJson && <span className="text-red-700 normal-case">• invalid JSON</span>}
            </label>
            {loading ? (
              <div className="text-sm text-ink-700">Loading…</div>
            ) : (
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full rounded-md border border-ink-200 px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            )}
          </div>

          {error && <div className="text-sm text-red-700 whitespace-pre-wrap">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !validJson || !name.trim()}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save workflow'}
          </button>
        </div>
      </div>
    </div>
  )
}
