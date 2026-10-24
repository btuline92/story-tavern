import { useState } from 'react'
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

/**
 * Presentational editor for a full GenerationSettings object (hyperparameters + stop
 * sequences + reasoning). Controlled — owns no persistence. Used by model presets for the main
 * model and for each utility-model override.
 */
export function GenerationFields({
  value,
  onChange
}: {
  value: GenerationSettings
  onChange: (next: GenerationSettings) => void
}): React.JSX.Element {
  const [stopInput, setStopInput] = useState('')

  const set = <K extends keyof GenerationSettings>(key: K, v: GenerationSettings[K]): void => {
    onChange({ ...value, [key]: v })
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-4">
        <NumField
          label="Max tokens"
          value={value.max_tokens}
          onChange={(v) => set('max_tokens', v ?? 4096)}
          min={1}
          step={1}
          hint="Cap on the model's response length."
        />
        <NumField
          label="Temperature"
          value={value.temperature}
          onChange={(v) => set('temperature', v ?? 1)}
          min={0}
          max={2}
          step={0.05}
          hint="Higher = wilder. 0.8–1.2 is the usual prose range."
        />
        <NumField
          label="top_p"
          value={value.top_p}
          onChange={(v) => set('top_p', v ?? 1)}
          min={0}
          max={1}
          step={0.01}
        />
        <NumField
          label="top_k (optional)"
          value={value.top_k}
          onChange={(v) => set('top_k', v)}
          min={0}
          step={1}
          nullable
        />
        <NumField
          label="min_p (optional, OpenAI-compat)"
          value={value.min_p}
          onChange={(v) => set('min_p', v)}
          min={0}
          max={1}
          step={0.01}
          nullable
        />
        <NumField
          label="Seed (optional)"
          value={value.seed}
          onChange={(v) => set('seed', v)}
          step={1}
          nullable
        />
        <NumField
          label="Frequency penalty (OpenAI/DeepSeek)"
          value={value.frequency_penalty}
          onChange={(v) => set('frequency_penalty', v ?? 0)}
          min={-2}
          max={2}
          step={0.05}
          hint="0 is recommended for prose."
        />
        <NumField
          label="Presence penalty (OpenAI/DeepSeek)"
          value={value.presence_penalty}
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
        <div className="rounded-md border border-ink-200 bg-surface p-2 flex flex-wrap gap-1.5">
          {value.stop_sequences.map((s, i) => (
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
                    value.stop_sequences.filter((_, j) => j !== i)
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
                set('stop_sequences', [...value.stop_sequences, stopInput])
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
          value={value.reasoning_level}
          onChange={(e) => set('reasoning_level', e.target.value as ReasoningLevel)}
          className="rounded-md border border-ink-200 px-3 py-2 text-sm bg-surface"
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
            translates it to the underlying model&apos;s mechanism.
          </div>
          <div>
            <strong>DeepSeek:</strong> reasoning is selected by model id (e.g.{' '}
            <code>deepseek-reasoner</code>), not via a request parameter. This setting still
            controls whether streamed thinking tokens are displayed during generation.
          </div>
        </div>
      </div>
    </>
  )
}
