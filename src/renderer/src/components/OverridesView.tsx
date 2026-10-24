import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type { OverrideQuestion, OverrideSettings } from '../types'

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function QuestionList({
  title,
  hint,
  placeholder,
  questions,
  onChange
}: {
  title: string
  hint: string
  placeholder: string
  questions: OverrideQuestion[]
  onChange: (next: OverrideQuestion[]) => void
}): React.JSX.Element {
  const update = (id: string, patch: Partial<OverrideQuestion>): void =>
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)))

  return (
    <div className="st-card p-4 mb-6 max-w-3xl">
      <div className="font-medium text-ink-900 mb-1">{title}</div>
      <div className="text-xs text-ink-700 mb-3">{hint}</div>
      <div className="space-y-2">
        {questions.length === 0 && (
          <div className="text-sm text-ink-700 italic">No questions — this check is skipped.</div>
        )}
        {questions.map((q) => (
          <div key={q.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={q.enabled}
              onChange={(e) => update(q.id, { enabled: e.target.checked })}
              title={q.enabled ? 'Enabled' : 'Disabled'}
              className="h-4 w-4 shrink-0 accent-accent-500"
            />
            <input
              type="text"
              value={q.text}
              onChange={(e) => update(q.id, { text: e.target.value })}
              placeholder={placeholder}
              className={`st-input flex-1 ${q.enabled ? '' : 'opacity-60'}`}
            />
            <button
              type="button"
              onClick={() => onChange(questions.filter((x) => x.id !== q.id))}
              title="Delete question"
              className="st-btn st-btn-sm st-btn-default"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...questions, { id: newId(), text: '', enabled: true }])}
        className="st-btn st-btn-sm st-btn-default mt-3"
      >
        + Add question
      </button>
    </div>
  )
}

export function OverridesView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings, hasKey } = useSettings()
  const [draft, setDraft] = useState<OverrideSettings | null>(settings?.overrides ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(settings?.overrides ?? null)
  }, [settings?.overrides])

  if (!settings || !draft) return <div className="p-8 text-ink-700">Loading…</div>

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.overrides)
  const save = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      await window.api.workspace.setSettings(workspace, { ...settings, overrides: draft })
      const refreshed = await window.api.workspace.getSettings(workspace)
      useSettings.setState({ settings: refreshed })
    } finally {
      setSaving(false)
    }
  }

  // Status of the active model preset — overrides only run when all of this is in place.
  const presets = settings.modelPresets
  const active = presets.find((p) => p.id === settings.activeModelPresetId) ?? presets[0]
  const problems: string[] = []
  if (!active.decision.enabled)
    problems.push('the active model preset has no decision model enabled')
  else if (!active.override.model.trim())
    problems.push('the active model preset has no override model picked')
  if (!hasKey.openrouter)
    problems.push('no OpenRouter API key is saved (the decision model uses it)')
  if (active.decision.enabled && active.override.model.trim() && !hasKey[active.override.provider])
    problems.push(`no ${active.override.provider} API key is saved for the override model`)

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between mb-6 max-w-3xl">
        <h2 className="text-2xl font-semibold text-ink-900">Overrides</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(settings.overrides)}
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

      <div className="st-card p-4 mb-6 max-w-3xl text-sm text-ink-900 space-y-2">
        <div className="font-medium">How overrides work</div>
        <p>
          Some models refuse or water down certain content. Overrides catch this and hand the
          generation to a different <strong>override model</strong> instead. A{' '}
          <strong>decision model</strong> (Jev) makes the call by answering the yes/no questions
          below.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>Prompt checks</strong> run before anything is sent. They look only at what this
            generation asks for: the current Magic Complete <strong>beat</strong>, or your note to
            the model for a plain Continue, or the instruction for a rewrite. They never see the
            system prompt or story so far. If any question comes back &ldquo;yes&rdquo; with at
            least the preset&apos;s threshold, the override model writes the passage and the main
            model is never called. A Continue with no note skips this step.
          </li>
          <li>
            <strong>Response checks</strong> run on the main model&apos;s finished reply. If one
            comes back &ldquo;yes&rdquo;, the reply is thrown away and the override model writes it
            again.
          </li>
        </ol>
        <p className="text-ink-700">
          This applies to Continue, Magic Complete passages, and highlight-to-act rewrites. The
          decision model, its threshold, and the override model are set per model preset (Model
          Presets → Decision &amp; override). If the decision model fails or times out, the main
          model&apos;s result is kept. The editor shows a note whenever an override happens.
        </p>
      </div>

      <div
        className={`st-card p-4 mb-6 max-w-3xl text-sm ${problems.length ? 'border-warning/40' : ''}`}
      >
        <div className="font-medium text-ink-900 mb-1">
          Active preset: {active.name || '(unnamed)'}
        </div>
        {problems.length === 0 ? (
          <div className="text-ink-700">
            Decision model <code>{active.decision.model}</code> (threshold{' '}
            {active.decision.threshold}) → override model <code>{active.override.model}</code>.
            Overrides are active.
          </div>
        ) : (
          <div className="text-warning">Overrides are inactive: {problems.join('; ')}.</div>
        )}
      </div>

      <QuestionList
        title="Prompt checks"
        hint="Asked about the current beat (or your Continue note, or a rewrite instruction). A “yes” means the main model would probably refuse or filter it, so the override model is used instead."
        placeholder="e.g. Does this request sexually explicit content?"
        questions={draft.promptChecks}
        onChange={(promptChecks) => setDraft({ ...draft, promptChecks })}
      />

      <QuestionList
        title="Response checks"
        hint="Asked about the main model's reply. A “yes” means it was refused or filtered, so the reply is discarded and the override model regenerates it."
        placeholder="e.g. Is this a refusal rather than story prose?"
        questions={draft.responseChecks}
        onChange={(responseChecks) => setDraft({ ...draft, responseChecks })}
      />

    </div>
  )
}
