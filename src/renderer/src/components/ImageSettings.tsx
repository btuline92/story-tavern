import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import type { ComfyObjectInfo, ImageSettings, ProviderId } from '../types'
import { ModelSelect } from './ModelSelect'
import { WorkflowEditor } from './WorkflowEditor'

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' }
]

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
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
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
    </div>
  )
}

function ComboField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}): React.JSX.Element {
  const listId = `combo-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={options.length === 0 ? 'Fetch from ComfyUI, or type' : 'Pick or type'}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  )
}

function TextAreaField({
  label,
  value,
  rows = 4,
  onChange,
  hint
}: {
  label: string
  value: string
  rows?: number
  onChange: (v: string) => void
  hint?: string
}): React.JSX.Element {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      {hint && <div className="text-xs text-ink-700 mt-1">{hint}</div>}
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

export function ImageSettingsPanel(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings, hasKey } = useSettings()
  const [draft, setDraft] = useState<ImageSettings | null>(settings?.image ?? null)
  const [saving, setSaving] = useState(false)

  // ComfyUI live data (independent of the saved draft)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [info, setInfo] = useState<ComfyObjectInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [workflows, setWorkflows] = useState<string[]>([])
  // null = editor closed; a string = open the workflow editor for that filename (existing or new).
  const [editorName, setEditorName] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(settings?.image ?? null)
  }, [settings?.image])

  useEffect(() => {
    window.api.comfy
      .listWorkflows(workspace)
      .then(setWorkflows)
      .catch(() => {})
  }, [workspace])

  if (!settings || !draft) return <></>

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.image)
  const set = <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  const save = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      await window.api.workspace.setSettings(workspace, { ...settings, image: draft })
      const refreshed = await window.api.workspace.getSettings(workspace)
      useSettings.setState({ settings: refreshed })
    } finally {
      setSaving(false)
    }
  }

  const onTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setInfoError(null)
    try {
      const r = await window.api.comfy.test(draft.comfyUrl)
      setTestResult(r)
      if (r.ok) await fetchInfo()
    } finally {
      setTesting(false)
    }
  }

  const fetchInfo = async (): Promise<void> => {
    setInfoError(null)
    const r = await window.api.comfy.objectInfo(draft.comfyUrl)
    if ('error' in r) {
      setInfoError(r.error)
      setInfo(null)
    } else {
      setInfo(r)
    }
  }

  const reloadWorkflows = async (): Promise<void> => {
    setWorkflows(await window.api.comfy.listWorkflows(workspace))
  }

  const onDeleteWorkflow = async (): Promise<void> => {
    if (!draft.workflow) return
    if (!confirm(`Delete workflow "${draft.workflow}"?`)) return
    const list = await window.api.comfy.deleteWorkflow(workspace, draft.workflow)
    setWorkflows(list)
    if (!list.includes(draft.workflow)) set('workflow', list[0] ?? '')
  }

  const onNewWorkflow = (): void => {
    // Open the editor with a fresh, unused filename. readWorkflow falls back to the default
    // template for a name that doesn't exist yet, so the editor opens pre-filled; saving creates it.
    const existing = new Set(workflows)
    let name = 'Workflow.json'
    let n = 2
    while (existing.has(name)) {
      name = `Workflow-${n}.json`
      n += 1
    }
    setEditorName(name)
  }

  // --- Tag prompts (named "scene instruction" prompts; one active at a time) ---
  const activeIdx = Math.max(
    0,
    draft.tagPrompts.findIndex((p) => p.name === draft.activeTagPrompt)
  )
  const activePrompt = draft.tagPrompts[activeIdx]

  const uniquePromptName = (base: string): string => {
    const names = new Set(draft.tagPrompts.map((p) => p.name))
    if (!names.has(base)) return base
    let n = 2
    while (names.has(`${base} ${n}`)) n += 1
    return `${base} ${n}`
  }
  const addTagPrompt = (): void => {
    const name = uniquePromptName('Prompt')
    setDraft({
      ...draft,
      tagPrompts: [...draft.tagPrompts, { name, text: activePrompt?.text ?? '' }],
      activeTagPrompt: name
    })
  }
  const deleteTagPrompt = (): void => {
    if (draft.tagPrompts.length <= 1) return
    const next = draft.tagPrompts.filter((_, i) => i !== activeIdx)
    setDraft({ ...draft, tagPrompts: next, activeTagPrompt: next[0].name })
  }
  const renameActivePrompt = (name: string): void => {
    setDraft({
      ...draft,
      tagPrompts: draft.tagPrompts.map((p, i) => (i === activeIdx ? { ...p, name } : p)),
      activeTagPrompt: name
    })
  }
  const setActivePromptText = (text: string): void => {
    setDraft({
      ...draft,
      tagPrompts: draft.tagPrompts.map((p, i) => (i === activeIdx ? { ...p, text } : p))
    })
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="font-medium text-ink-900">Images (ComfyUI)</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(settings.image)}
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

      <div className="flex flex-col gap-2 mb-4">
        <Toggle
          label="Enable image generation"
          checked={draft.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <Toggle
          label="Generate an image automatically after each Continue"
          checked={draft.autoAfterContinue}
          onChange={(v) => set('autoAfterContinue', v)}
        />
      </div>

      {/* Connection */}
      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          ComfyUI server URL
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft.comfyUrl}
            onChange={(e) => set('comfyUrl', e.target.value)}
            placeholder="http://127.0.0.1:8188"
            className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-2 text-sm ${testResult.ok ? 'text-green-700' : 'text-red-700'}`}>
            {testResult.ok ? '✓ Connected' : `✗ ${testResult.error}`}
          </div>
        )}
      </div>

      {/* Workflow */}
      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Workflow
        </label>
        <div className="flex gap-2">
          <select
            value={draft.workflow}
            onChange={(e) => set('workflow', e.target.value)}
            className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm bg-white"
          >
            {workflows.length === 0 && <option value={draft.workflow}>{draft.workflow}</option>}
            {workflows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onNewWorkflow}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100"
          >
            New…
          </button>
          <button
            type="button"
            onClick={() => setEditorName(draft.workflow)}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100"
          >
            Edit…
          </button>
          <button
            type="button"
            onClick={onDeleteWorkflow}
            className="rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
          >
            Delete
          </button>
        </div>
        <div className="text-xs text-ink-700 mt-1">
          Workflows live in <code>comfy-workflows/</code> and use <code>%prompt%</code>-style
          placeholders.
        </div>
      </div>

      {/* ComfyUI params */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-700">
          Generation parameters
        </div>
        <button
          type="button"
          onClick={fetchInfo}
          className="text-xs text-accent-500 hover:text-accent-600"
        >
          ↻ Fetch model/sampler lists
        </button>
      </div>
      {infoError && <div className="text-xs text-red-700 mb-2">{infoError}</div>}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <ComboField
          label="Model (checkpoint)"
          value={draft.model}
          options={info?.models ?? []}
          onChange={(v) => set('model', v)}
        />
        <ComboField
          label="VAE"
          value={draft.vae}
          options={info?.vaes ?? []}
          onChange={(v) => set('vae', v)}
        />
        <ComboField
          label="Sampler"
          value={draft.sampler}
          options={info?.samplers ?? []}
          onChange={(v) => set('sampler', v)}
        />
        <ComboField
          label="Scheduler"
          value={draft.scheduler}
          options={info?.schedulers ?? []}
          onChange={(v) => set('scheduler', v)}
        />
        <NumField label="Steps" value={draft.steps} onChange={(v) => set('steps', v)} min={1} />
        <NumField label="CFG scale" value={draft.cfg} onChange={(v) => set('cfg', v)} step={0.5} />
        <NumField label="Width" value={draft.width} onChange={(v) => set('width', v)} step={64} />
        <NumField
          label="Height"
          value={draft.height}
          onChange={(v) => set('height', v)}
          step={64}
        />
        <NumField label="Seed (-1 = random)" value={draft.seed} onChange={(v) => set('seed', v)} />
        <NumField
          label="Denoise"
          value={draft.denoise}
          onChange={(v) => set('denoise', v)}
          step={0.05}
        />
        <NumField label="Clip skip" value={draft.clipSkip} onChange={(v) => set('clipSkip', v)} />
      </div>

      {/* Prompt prefixes */}
      <TextAreaField
        label="Positive prompt prefix"
        value={draft.promptPrefix}
        rows={2}
        onChange={(v) => set('promptPrefix', v)}
        hint="Prepended to the generated tags before sending to ComfyUI."
      />
      <TextAreaField
        label="Negative prompt"
        value={draft.negativePrompt}
        rows={2}
        onChange={(v) => set('negativePrompt', v)}
      />

      {/* Tag generation prompts */}
      <div className="mt-4 pt-4 border-t border-ink-200">
        <div className="font-medium text-ink-900 mb-3">Tag generation (LLM → Danbooru tags)</div>

        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
            Appearance source
          </label>
          <select
            value={draft.appearanceSource}
            onChange={(e) =>
              set('appearanceSource', e.target.value as 'description' | 'appearance')
            }
            className="rounded-md border border-ink-200 px-3 py-2 text-sm bg-white"
          >
            <option value="description">Character description</option>
            <option value="appearance">Appearance tags</option>
          </select>
          <div className="text-xs text-ink-700 mt-1">
            How the tagger learns each character&apos;s looks. &quot;Appearance tags&quot; sends a
            compact &quot;Name: tags&quot; line per character; &quot;Character description&quot;
            sends the full description prose.
          </div>
        </div>

        <TextAreaField
          label="Tag system prompt"
          value={draft.tagSystemPrompt}
          rows={8}
          onChange={(v) => set('tagSystemPrompt', v)}
        />

        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
            Image tag prompt (scene instruction)
          </label>
          <div className="flex gap-2 mb-2">
            <select
              value={activePrompt?.name ?? ''}
              onChange={(e) => set('activeTagPrompt', e.target.value)}
              className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm bg-white"
            >
              {draft.tagPrompts.map((p, i) => (
                <option key={i} value={p.name}>
                  {p.name || '(unnamed)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addTagPrompt}
              className="rounded-md border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100"
            >
              + Add
            </button>
            <button
              type="button"
              onClick={deleteTagPrompt}
              disabled={draft.tagPrompts.length <= 1}
              className="rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
          <input
            type="text"
            value={activePrompt?.name ?? ''}
            onChange={(e) => renameActivePrompt(e.target.value)}
            placeholder="Prompt name (e.g. Close-up, Wide shot)"
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <textarea
            value={activePrompt?.text ?? ''}
            rows={4}
            onChange={(e) => setActivePromptText(e.target.value)}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <NumField
            label="Tagging temperature"
            value={draft.tagTemperature}
            onChange={(v) => set('tagTemperature', v)}
            step={0.05}
            min={0}
          />
        </div>
        <div className="mb-4">
          <Toggle
            label="Disable thinking for tagging (faster)"
            checked={draft.tagDisableThinking}
            onChange={(v) => set('tagDisableThinking', v)}
          />
          <div className="text-xs text-ink-700 mt-1">
            Tagging is a quick classification — skipping reasoning makes it faster. Off lets tagging
            use the workspace reasoning level. (For DeepSeek, reasoning is set by model choice —
            pick a non-reasoning model to skip it.)
          </div>
        </div>
        <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
          <Toggle
            label="Use a different model for tagging"
            checked={draft.tagModelOverride.enabled}
            onChange={(v) => set('tagModelOverride', { ...draft.tagModelOverride, enabled: v })}
          />
          {draft.tagModelOverride.enabled && (
            <div className="mt-3 grid grid-cols-[8rem_1fr] gap-2 items-start">
              <select
                value={draft.tagModelOverride.provider}
                onChange={(e) =>
                  set('tagModelOverride', {
                    ...draft.tagModelOverride,
                    provider: e.target.value as ProviderId
                  })
                }
                className="rounded-md border border-ink-200 px-2 py-2 text-sm bg-white"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ModelSelect
                provider={draft.tagModelOverride.provider}
                value={draft.tagModelOverride.model}
                hasKey={hasKey[draft.tagModelOverride.provider]}
                onChange={(model) => set('tagModelOverride', { ...draft.tagModelOverride, model })}
              />
            </div>
          )}
          {!draft.tagModelOverride.enabled && (
            <div className="text-xs text-ink-700 mt-1">Uses the active story provider/model.</div>
          )}
        </div>
      </div>

      {editorName !== null && (
        <WorkflowEditor
          workspace={workspace}
          initialName={editorName}
          onClose={() => setEditorName(null)}
          onSaved={async (name) => {
            await reloadWorkflows()
            set('workflow', name)
            setEditorName(null)
          }}
        />
      )}
    </div>
  )
}
