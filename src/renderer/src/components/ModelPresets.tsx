import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type {
  DecisionConfig,
  GenerationSettings,
  ModelPreset,
  ModelRole,
  OverrideConfig,
  ProviderId,
  RoleConfig
} from '../types'
import { ModelSelect } from './ModelSelect'
import { GenerationFields } from './GenerationSettings'

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'nanogpt', name: 'NanoGPT' },
  { id: 'featherless', name: 'Featherless' }
]

/** Utility features that can override the main model. Adding a role = one entry here plus a
 *  resolveModelFor(settings, '<role>') call in the main process. */
const ROLE_DEFS: { id: ModelRole; label: string; hint: string }[] = [
  {
    id: 'outline',
    label: 'Outline suggestions',
    hint: 'Suggesting chapter outlines in the story editor.'
  },
  {
    id: 'character',
    label: 'Character creation',
    hint: 'Generating a character with AI.'
  },
  {
    id: 'beatPlan',
    label: 'Beat planning (Magic Complete)',
    hint: 'Planning story beats when Magic Complete starts. Passages still use the main model.'
  },
  {
    id: 'imageTagging',
    label: 'Image tagging',
    hint: 'Turning a passage into image tags. Reasoning off keeps tagging fast.'
  },
  {
    id: 'summarizer',
    label: 'Summarizer',
    hint: 'Folding old chapters into the running story summary.'
  }
]

const DEFAULT_DECISION: DecisionConfig = {
  enabled: false,
  model: '~typesafe/jev-latest',
  baseUrl: 'https://openrouter.ai/api',
  threshold: 0.5,
  timeoutMs: 5000
}

/** Jev model ids on OpenRouter; any other id can be typed. */
const JEV_MODELS = ['~typesafe/jev-latest', 'typesafe/jev-1.14', 'typesafe/jev-1.13']

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function uniqueName(existing: string[], base: string): string {
  const names = new Set(existing)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

/** A preset's config for a role; a missing role means "same as main" for both model and settings.
 *  The custom fields start from the main model so unchecking begins from a sensible value. */
function roleOf(preset: ModelPreset, role: ModelRole): RoleConfig {
  return (
    preset.roles[role] ?? {
      useMainModel: true,
      provider: preset.provider,
      model: preset.model,
      useMainGeneration: true,
      generation: { ...preset.generation }
    }
  )
}

function roleSummary(cfg: RoleConfig): string {
  const customModel = !cfg.useMainModel
  if (!customModel && cfg.useMainGeneration) return 'Same as main'
  const model = customModel ? cfg.model || '(no model selected)' : 'Main model'
  const gen = cfg.useMainGeneration ? 'main settings' : 'custom settings'
  return `${model} · ${gen}`
}

interface Draft {
  modelPresets: ModelPreset[]
  activeModelPresetId: string | null
}

function RoleEditor({
  def,
  cfg,
  hasKey,
  onChange
}: {
  def: (typeof ROLE_DEFS)[number]
  cfg: RoleConfig
  hasKey: Record<ProviderId, boolean>
  onChange: (patch: Partial<RoleConfig>) => void
}): React.JSX.Element {
  return (
    <details className="rounded-md border border-ink-200 bg-ink-50">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2">
        <span className="text-sm font-medium text-ink-900">{def.label}</span>
        <span className="truncate text-xs text-ink-700">{roleSummary(cfg)}</span>
      </summary>
      <div className="space-y-3 border-t border-ink-200 px-3 py-3">
        <div className="text-xs text-ink-700">{def.hint}</div>
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={cfg.useMainModel}
            onChange={(e) => onChange({ useMainModel: e.target.checked })}
            className="h-4 w-4 accent-accent-500"
          />
          <span className="text-sm text-ink-900">Model: same as main</span>
        </label>
        {!cfg.useMainModel && (
          <div className="grid grid-cols-[10rem_1fr] items-start gap-2">
            <select
              value={cfg.provider}
              onChange={(e) => onChange({ provider: e.target.value as ProviderId })}
              className="st-select"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ModelSelect
              provider={cfg.provider}
              value={cfg.model}
              hasKey={hasKey[cfg.provider]}
              onChange={(model) => onChange({ model })}
              liveCommit
            />
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={cfg.useMainGeneration}
            onChange={(e) => onChange({ useMainGeneration: e.target.checked })}
            className="h-4 w-4 accent-accent-500"
          />
          <span className="text-sm text-ink-900">Generation settings: same as main</span>
        </label>
        {!cfg.useMainGeneration && (
          <GenerationFields
            value={cfg.generation}
            onChange={(g: GenerationSettings) => onChange({ generation: g })}
          />
        )}
      </div>
    </details>
  )
}

function DecisionEditor({
  cfg,
  hasKey,
  onChange
}: {
  cfg: DecisionConfig
  hasKey: boolean
  onChange: (patch: Partial<DecisionConfig>) => void
}): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      const r = await window.api.decision.test(
        { model: cfg.model, baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs },
        undefined,
        workspace
      )
      setOk(r.ok)
      setResult(
        r.ok
          ? `✓ ${r.model ?? cfg.model} answered in ${r.durationMs} ms` +
              (r.probability != null ? ` (test answer: ${r.probability.toFixed(2)})` : '')
          : `✗ ${r.error}`
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-3 space-y-3">
      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 accent-accent-500"
        />
        <span className="text-sm font-medium text-ink-900">Use a decision model</span>
      </label>
      <div className="text-xs text-ink-700">
        A System One decision model (TypeSafe Jev, via OpenRouter) answers structured questions
        about the story — yes/no, pick-one, or a score — and decides when the override model
        replaces the main model. It never writes text, so it has no sampling or reasoning settings.
      </div>
      {cfg.enabled && (
        <>
          {!hasKey && (
            <div className="text-xs text-danger">
              No OpenRouter API key saved — add one under Settings → Providers &amp; API keys.
            </div>
          )}
          <div className="grid grid-cols-[1fr_8rem_8rem] gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
                Model
              </label>
              <input
                type="text"
                list="jev-models"
                value={cfg.model}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder="~typesafe/jev-latest"
                className="st-input w-full"
              />
              <datalist id="jev-models">
                {JEV_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700"
                title="Probability (0–1) a decision must reach before the override model is used"
              >
                Threshold
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={cfg.threshold}
                onChange={(e) =>
                  onChange({ threshold: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })
                }
                className="st-input w-full"
              />
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700"
                title="If the decision model doesn't answer in time, the main model is used"
              >
                Timeout (ms)
              </label>
              <input
                type="number"
                min={500}
                step={500}
                value={cfg.timeoutMs}
                onChange={(e) =>
                  onChange({ timeoutMs: Math.max(500, Math.round(Number(e.target.value) || 0)) })
                }
                className="st-input w-full"
              />
            </div>
          </div>
          <details>
            <summary className="cursor-pointer select-none text-xs text-ink-700">Advanced</summary>
            <div className="mt-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
                API base URL
              </label>
              <input
                type="text"
                value={cfg.baseUrl}
                onChange={(e) => onChange({ baseUrl: e.target.value })}
                placeholder={DEFAULT_DECISION.baseUrl}
                className="st-input w-full"
              />
              <div className="mt-1 text-xs text-ink-700">
                OpenRouter&apos;s System One API by default. Requests go to{' '}
                <code>{'<base URL>'}/v1/systemone</code>.
              </div>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={test}
              disabled={testing || !hasKey || !cfg.model.trim()}
              className="st-btn st-btn-sm st-btn-default"
            >
              {testing ? 'Testing…' : 'Test decision model'}
            </button>
            {result && (
              <span className={`text-xs ${ok ? 'text-success' : 'text-danger'} break-all`}>
                {result}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function OverrideEditor({
  cfg,
  hasKey,
  onChange
}: {
  cfg: OverrideConfig
  hasKey: Record<ProviderId, boolean>
  onChange: (patch: Partial<OverrideConfig>) => void
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-3 space-y-3">
      <div className="text-sm font-medium text-ink-900">Override model</div>
      <div className="text-xs text-ink-700">
        Used in place of the main model when the decision model says so.
      </div>
      <div className="grid grid-cols-[10rem_1fr] items-start gap-2">
        <select
          value={cfg.provider}
          onChange={(e) => onChange({ provider: e.target.value as ProviderId })}
          className="st-select"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <ModelSelect
          provider={cfg.provider}
          value={cfg.model}
          hasKey={hasKey[cfg.provider]}
          onChange={(model) => onChange({ model })}
          liveCommit
        />
      </div>
      {!cfg.model.trim() && (
        <div className="text-xs text-danger">
          Pick an override model — until then the main model is always used.
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={cfg.useMainGeneration}
          onChange={(e) => onChange({ useMainGeneration: e.target.checked })}
          className="h-4 w-4 accent-accent-500"
        />
        <span className="text-sm text-ink-900">Generation settings: same as main</span>
      </label>
      {!cfg.useMainGeneration && (
        <GenerationFields
          value={cfg.generation}
          onChange={(g: GenerationSettings) => onChange({ generation: g })}
        />
      )}
    </div>
  )
}

export function ModelPresetsPanel(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings, hasKey } = useSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(null)
      return
    }

    setDraft({
      modelPresets: settings.modelPresets,
      activeModelPresetId: settings.activeModelPresetId
    })
    setEditingId((cur) =>
      cur && settings.modelPresets.some((p) => p.id === cur)
        ? cur
        : (settings.activeModelPresetId ?? settings.modelPresets[0]?.id ?? null)
    )
  }, [settings?.modelPresets, settings?.activeModelPresetId])

  if (!settings || !draft || draft.modelPresets.length === 0) return <></>

  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify({
      modelPresets: settings.modelPresets,
      activeModelPresetId: settings.activeModelPresetId
    })

  const editing = draft.modelPresets.find((p) => p.id === editingId) ?? draft.modelPresets[0]

  const updateEditing = (patch: Partial<ModelPreset>): void => {
    setDraft({
      ...draft,
      modelPresets: draft.modelPresets.map((p) => (p.id === editing.id ? { ...p, ...patch } : p))
    })
  }

  const updateRole = (role: ModelRole, patch: Partial<RoleConfig>): void => {
    updateEditing({ roles: { ...editing.roles, [role]: { ...roleOf(editing, role), ...patch } } })
  }

  const insertPreset = (preset: ModelPreset): void => {
    setDraft({ ...draft, modelPresets: [...draft.modelPresets, preset] })
    setEditingId(preset.id)
  }

  const addPreset = (): void => {
    insertPreset({
      id: newId(),
      name: uniqueName(
        draft.modelPresets.map((p) => p.name),
        'New preset'
      ),
      provider: editing.provider,
      model: editing.model,
      generation: { ...editing.generation },
      notes: '',
      // Every utility model starts as "same as main".
      roles: {},
      decision: { ...DEFAULT_DECISION },
      override: {
        provider: editing.provider,
        model: '',
        useMainGeneration: true,
        generation: { ...editing.generation }
      }
    })
  }

  const duplicatePreset = (): void => {
    // Deep clone keeps every utility override (and any fields this version doesn't know about).
    insertPreset({
      ...structuredClone(editing),
      id: newId(),
      name: uniqueName(
        draft.modelPresets.map((p) => p.name),
        `${editing.name || 'Preset'} (copy)`
      )
    })
  }

  const deletePreset = (): void => {
    if (draft.modelPresets.length <= 1) return
    const next = draft.modelPresets.filter((p) => p.id !== editing.id)
    const activeModelPresetId =
      draft.activeModelPresetId === editing.id ? next[0].id : draft.activeModelPresetId
    setDraft({ ...draft, modelPresets: next, activeModelPresetId })
    setEditingId(next[0].id)
  }

  const save = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      const activeModelPresetId = draft.modelPresets.some((p) => p.id === draft.activeModelPresetId)
        ? draft.activeModelPresetId
        : (draft.modelPresets[0]?.id ?? null)
      await window.api.workspace.setSettings(workspace, {
        ...settings,
        modelPresets: draft.modelPresets,
        activeModelPresetId
      })
      const refreshed = await window.api.workspace.getSettings(workspace)
      useSettings.setState({ settings: refreshed })
    } finally {
      setSaving(false)
    }
  }

  const discard = (): void => {
    setDraft({
      modelPresets: settings.modelPresets,
      activeModelPresetId: settings.activeModelPresetId
    })
  }

  return (
    <div className="st-card p-4 mb-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="font-medium text-ink-900">Model presets</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={discard}
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

      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Active for generation
        </label>
        <select
          value={draft.activeModelPresetId ?? ''}
          onChange={(e) => setDraft({ ...draft, activeModelPresetId: e.target.value })}
          className="st-select w-full"
        >
          {draft.modelPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || '(unnamed)'}
            </option>
          ))}
        </select>
        <div className="text-xs text-ink-700 mt-1">
          The preset used for all generation. You can also switch it from the story editor.
        </div>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Edit preset
        </label>
        <div className="flex gap-2 mb-2">
          <select
            value={editing.id}
            onChange={(e) => setEditingId(e.target.value)}
            className="st-select flex-1"
          >
            {draft.modelPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || '(unnamed)'}
              </option>
            ))}
          </select>
          <button type="button" onClick={addPreset} className="st-btn st-btn-sm st-btn-default">
            + New
          </button>
          <button
            type="button"
            onClick={duplicatePreset}
            title="Copy this preset, including its utility models"
            className="st-btn st-btn-sm st-btn-default"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={deletePreset}
            disabled={draft.modelPresets.length <= 1}
            className="st-btn st-btn-sm st-btn-default"
          >
            Delete
          </button>
        </div>
        <input
          type="text"
          value={editing.name}
          onChange={(e) => updateEditing({ name: e.target.value })}
          placeholder="Preset name (e.g. Opus 5, Fast draft)"
          className="st-input w-full mb-3"
        />
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-700">
          Main model
        </div>
        <div className="mb-4 grid grid-cols-[10rem_1fr] items-start gap-2">
          <select
            value={editing.provider}
            onChange={(e) => updateEditing({ provider: e.target.value as ProviderId })}
            className="st-select"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ModelSelect
            provider={editing.provider}
            value={editing.model}
            hasKey={hasKey[editing.provider]}
            onChange={(model) => updateEditing({ model })}
            liveCommit
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
            Notes
          </label>
          <textarea
            value={editing.notes}
            onChange={(e) => updateEditing({ notes: e.target.value })}
            rows={3}
            placeholder="What is this model good at? e.g. great prose, weak at long plots; cheap for drafts…"
            className="st-textarea w-full resize-y"
          />
        </div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-700">
          Main model generation settings
        </div>
        <GenerationFields
          value={editing.generation}
          onChange={(g: GenerationSettings) => updateEditing({ generation: g })}
        />

        <div className="mt-6 border-t border-ink-200 pt-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-700">
            Utility models
          </div>
          <div className="mb-3 text-xs text-ink-700">
            Optionally use a different model or generation settings for specific features. Each
            follows the main model unless you uncheck “same as main”.
          </div>
          <div className="space-y-2">
            {ROLE_DEFS.map((def) => (
              <RoleEditor
                key={def.id}
                def={def}
                cfg={roleOf(editing, def.id)}
                hasKey={hasKey}
                onChange={(patch) => updateRole(def.id, patch)}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-ink-200 pt-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-700">
            Decision &amp; override
          </div>
          <div className="space-y-2">
            <DecisionEditor
              cfg={editing.decision}
              hasKey={hasKey.openrouter}
              onChange={(patch) => updateEditing({ decision: { ...editing.decision, ...patch } })}
            />
            {editing.decision.enabled && (
              <OverrideEditor
                cfg={editing.override}
                hasKey={hasKey}
                onChange={(patch) => updateEditing({ override: { ...editing.override, ...patch } })}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
