import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type { ProviderId, SummarizerSettings } from '../types'
import { ModelSelect } from './ModelSelect'
import { GenerationFields } from './GenerationSettings'

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'nanogpt', name: 'NanoGPT' }
]

function NumField({
  label,
  value,
  onChange,
  min = 1
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent-500"
      />
      <span className="text-sm text-ink-900">{label}</span>
    </label>
  )
}

export function SummarizerPanel(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings, hasKey } = useSettings()
  const [draft, setDraft] = useState<SummarizerSettings | null>(settings?.summarizer ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(settings?.summarizer ?? null)
  }, [settings?.summarizer])

  if (!settings || !draft) return <></>

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.summarizer)
  const set = <K extends keyof SummarizerSettings>(key: K, value: SummarizerSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  const save = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      await window.api.workspace.setSettings(workspace, { ...settings, summarizer: draft })
      const refreshed = await window.api.workspace.getSettings(workspace)
      useSettings.setState({ settings: refreshed })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="st-card p-4 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="font-medium text-ink-900">Story summarizer</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(settings.summarizer)}
            disabled={!dirty}
            className="st-btn st-btn-sm st-btn-default"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="st-btn st-btn-sm st-btn-primary"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <Toggle
          label="Enable summarization"
          checked={draft.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <p className="text-xs text-ink-700">
          When enabled, the oldest chapters are folded into a running summary and dropped from the
          model&apos;s context, keeping recent chapters verbatim. Disabling sends every chapter
          again (a stored summary is kept for later).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Min recent chapters (N)"
            value={draft.minChapters}
            onChange={(v) => set('minChapters', Math.max(1, Math.round(v)))}
          />
          <NumField
            label="Chapters per summary (M)"
            value={draft.batchSize}
            onChange={(v) => set('batchSize', Math.max(1, Math.round(v)))}
          />
        </div>
        <p className="text-xs text-ink-700">
          Summarizing runs once there are more than N+M unsummarized chapters, folding the oldest M
          into the summary — so the context keeps the summary plus the most recent unsummarized
          chapters.
        </p>

        <Toggle
          label="Ask before summarizing"
          checked={draft.confirmBeforeSummarizing}
          onChange={(v) => set('confirmBeforeSummarizing', v)}
        />

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
            Summarizer prompt
          </label>
          <textarea
            value={draft.prompt}
            rows={10}
            onChange={(e) => set('prompt', e.target.value)}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>

        <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
          <Toggle
            label="Use a different model for summarizing"
            checked={draft.modelOverride.enabled}
            onChange={(v) => set('modelOverride', { ...draft.modelOverride, enabled: v })}
          />
          {draft.modelOverride.enabled ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-[8rem_1fr] gap-2 items-start">
                <select
                  value={draft.modelOverride.provider}
                  onChange={(e) =>
                    set('modelOverride', {
                      ...draft.modelOverride,
                      provider: e.target.value as ProviderId
                    })
                  }
                  className="rounded-md border border-ink-200 px-2 py-2 text-sm bg-surface"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ModelSelect
                  provider={draft.modelOverride.provider}
                  value={draft.modelOverride.model}
                  hasKey={hasKey[draft.modelOverride.provider]}
                  onChange={(model) => set('modelOverride', { ...draft.modelOverride, model })}
                  liveCommit
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-700">
                  Generation settings for this model
                </div>
                <GenerationFields value={draft.generation} onChange={(g) => set('generation', g)} />
              </div>
            </div>
          ) : (
            <div className="text-xs text-ink-700 mt-1">
              Uses the active model preset — its provider, model, and hyperparameters. (We
              don&apos;t impose our own sampling settings, since many models are picky about them.)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
