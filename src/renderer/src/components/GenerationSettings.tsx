import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type { GenerationSettings, ReasoningLevel } from '../types'

interface NumFieldProps {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  step?: number
  hint?: string
  nullable?: boolean
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  nullable = false
}: NumFieldProps): React.JSX.Element {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={nullable ? 'unset' : undefined}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '' && nullable) {
            onChange(null)
          } else if (raw === '') {
            onChange(0)
          } else {
            onChange(Number(raw))
          }
        }}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      {hint && <div className="text-xs text-ink-700 mt-1">{hint}</div>}
    </div>
  )
}

export function GenerationSettingsPanel(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings } = useSettings()
  const [draft, setDraft] = useState<GenerationSettings | null>(settings?.generation ?? null)
  const [stopInput, setStopInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(settings?.generation ?? null)
  }, [settings?.generation])

  if (!settings || !draft) return <></>

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.generation)

  const set = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  const save = async (): Promise<void> => {
    if (!dirty || !draft) return
    setSaving(true)
    try {
      await window.api.workspace.setSettings(workspace, { ...settings, generation: draft })
      // Refresh in-store
      const refreshed = await window.api.workspace.getSettings(workspace)
      useSettings.setState({ settings: refreshed })
    } finally {
      setSaving(false)
    }
  }

  const discard = (): void => {
    setDraft(settings.generation)
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="font-medium text-ink-900">Generation</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={!dirty}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <NumField
          label="Max tokens"
          value={draft.max_tokens}
          onChange={(v) => set('max_tokens', v ?? 4096)}
          min={1}
          step={1}
          hint="Cap on the model's response length."
        />
        <NumField
          label="Temperature"
          value={draft.temperature}
          onChange={(v) => set('temperature', v ?? 1)}
          min={0}
          max={2}
          step={0.05}
          hint="Higher = wilder. 0.8–1.2 is the usual prose range."
        />
        <NumField
          label="top_p"
          value={draft.top_p}
          onChange={(v) => set('top_p', v ?? 1)}
          min={0}
          max={1}
          step={0.01}
        />
        <NumField
          label="top_k (optional)"
          value={draft.top_k}
          onChange={(v) => set('top_k', v)}
          min={0}
          step={1}
          nullable
        />
        <NumField
          label="min_p (optional, OpenAI-compat)"
          value={draft.min_p}
          onChange={(v) => set('min_p', v)}
          min={0}
          max={1}
          step={0.01}
          nullable
        />
        <NumField
          label="Seed (optional)"
          value={draft.seed}
          onChange={(v) => set('seed', v)}
          step={1}
          nullable
        />
        <NumField
          label="Frequency penalty (OpenAI/DeepSeek)"
          value={draft.frequency_penalty}
          onChange={(v) => set('frequency_penalty', v ?? 0)}
          min={-2}
          max={2}
          step={0.05}
          hint="0 is recommended for prose."
        />
        <NumField
          label="Presence penalty (OpenAI/DeepSeek)"
          value={draft.presence_penalty}
          onChange={(v) => set('presence_penalty', v ?? 0)}
          min={-2}
          max={2}
          step={0.05}
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Stop sequences
        </label>
        <div className="rounded-md border border-ink-200 bg-white p-2 flex flex-wrap gap-1.5">
          {draft.stop_sequences.map((s, i) => (
            <span
              key={`${s}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700 font-mono"
            >
              {JSON.stringify(s)}
              <button
                type="button"
                onClick={() =>
                  set(
                    'stop_sequences',
                    draft.stop_sequences.filter((_, j) => j !== i)
                  )
                }
                className="text-ink-700 hover:text-ink-900"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={stopInput}
            placeholder="Press Enter to add"
            onChange={(e) => setStopInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && stopInput) {
                e.preventDefault()
                set('stop_sequences', [...draft.stop_sequences, stopInput])
                setStopInput('')
              }
            }}
            className="flex-1 min-w-[10rem] text-sm focus:outline-none bg-transparent"
          />
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-ink-200">
        <div className="font-medium text-ink-900 mb-2">Reasoning / thinking</div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Level
        </label>
        <select
          value={draft.reasoning_level}
          onChange={(e) => set('reasoning_level', e.target.value as ReasoningLevel)}
          className="rounded-md border border-ink-200 px-3 py-2 text-sm bg-white"
        >
          <option value="off">off</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        <div className="text-xs text-ink-700 mt-2 space-y-1">
          <div>
            <strong>Anthropic:</strong> sent as <code>thinking.budget_tokens</code> — low ≈ 2k,
            medium ≈ 8k, high ≈ 24k. <code>max_tokens</code> auto-bumped to fit. Forces
            temperature&nbsp;=&nbsp;1.
          </div>
          <div>
            <strong>OpenAI o-series:</strong> sent as <code>reasoning_effort</code>. Ignored on
            non-reasoning models.
          </div>
          <div>
            <strong>OpenRouter:</strong> sent as <code>reasoning.effort</code>; OpenRouter
            translates it to the underlying model's mechanism.
          </div>
          <div>
            <strong>DeepSeek:</strong> reasoning is selected by model id (e.g.{' '}
            <code>deepseek-reasoner</code>), not via a request parameter. This setting still
            controls whether streamed thinking tokens are displayed during generation.
          </div>
        </div>
      </div>
    </div>
  )
}
