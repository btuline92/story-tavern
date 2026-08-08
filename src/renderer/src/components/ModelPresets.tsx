import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type { GenerationSettings, ModelPreset, ProviderId } from '../types'
import { ModelSelect } from './ModelSelect'
import { GenerationFields } from './GenerationSettings'

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'nanogpt', name: 'NanoGPT' }
]

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

interface Draft {
  modelPresets: ModelPreset[]
  activeModelPresetId: string | null
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

  const addPreset = (): void => {
    const preset: ModelPreset = {
      id: newId(),
      name: uniqueName(
        draft.modelPresets.map((p) => p.name),
        'New preset'
      ),
      provider: editing.provider,
      model: editing.model,
      generation: { ...editing.generation }
    }
    setDraft({ ...draft, modelPresets: [...draft.modelPresets, preset] })
    setEditingId(preset.id)
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
    <div className="st-card p-4 mb-6">
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
          The preset used for story and character generation. You can also switch it from the story
          editor.
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
          />
        </div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-700">
          Generation settings for this preset
        </div>
        <GenerationFields
          value={editing.generation}
          onChange={(g: GenerationSettings) => updateEditing({ generation: g })}
        />
      </div>
    </div>
  )
}
