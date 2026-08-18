import { useEffect, useRef, useState } from 'react'
import { usePresets } from '../stores/presets'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import { askConfirm } from '../stores/dialog'
import type { BlockRole, MarkerType, Preset, PromptBlock } from '../types'

const MARKER_LABELS: Record<MarkerType, string> = {
  char_description: 'Character description',
  char_personality: 'Character personality',
  char_system_prompt: 'Character instructions (card system prompt)',
  scenario: 'Scenario',
  dialogue_examples: 'Dialogue examples',
  story_premise: 'Story premise',
  manuscript: 'Manuscript (story so far)',
  unsupported: 'Unsupported (ignored)'
}

// Marker types offered in the block "content source" picker (unsupported is only kept for round-trip).
const MARKER_TYPE_OPTIONS = (Object.keys(MARKER_LABELS) as MarkerType[]).filter(
  (m) => m !== 'unsupported'
)
const TEXT_SOURCE = '__text__'

const ROLE_COLORS: Record<BlockRole, string> = {
  system: 'bg-ink-100 text-ink-700',
  user: 'bg-blue-100 text-blue-800',
  assistant: 'bg-purple-100 text-purple-800'
}

function newBlockId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function BlockRow({
  block,
  onToggle,
  onChange,
  onDelete,
  onMove,
  isFirst,
  isLast
}: {
  block: PromptBlock
  onToggle: () => void
  onChange: (patch: Partial<PromptBlock>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="border-b border-ink-200">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={block.enabled}
          onChange={onToggle}
          title={block.enabled ? 'Enabled — sent to the model' : 'Disabled'}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`flex-1 text-left truncate ${block.enabled ? 'text-ink-900' : 'text-ink-700 line-through opacity-60'}`}
        >
          {block.name}
        </button>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${ROLE_COLORS[block.role]}`}>
          {block.role}
        </span>
        {block.marker && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-warning/20 text-warning">
            dynamic
          </span>
        )}
        <div className="shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="px-1 text-ink-700 hover:text-ink-900 disabled:opacity-30"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="px-1 text-ink-700 hover:text-ink-900 disabled:opacity-30"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="px-1 text-ink-700 hover:text-danger"
            title="Delete this block"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 bg-ink-50">
          <div className="flex gap-2 items-center pt-2">
            <input
              type="text"
              value={block.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="flex-1 rounded-md border border-ink-200 px-2 py-1 text-sm"
              placeholder="Block name"
            />
            <select
              value={block.role}
              onChange={(e) => onChange({ role: e.target.value as BlockRole })}
              className="rounded-md border border-ink-200 px-2 py-1 text-sm bg-surface"
            >
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-700">Content source</span>
            <select
              value={block.marker ? (block.markerType ?? 'unsupported') : TEXT_SOURCE}
              onChange={(e) => {
                const v = e.target.value
                if (v === TEXT_SOURCE) onChange({ marker: false, markerType: null })
                else onChange({ marker: true, markerType: v as MarkerType, content: '' })
              }}
              className="rounded-md border border-ink-200 px-2 py-1 text-sm bg-surface"
            >
              <option value={TEXT_SOURCE}>Custom text</option>
              {MARKER_TYPE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {MARKER_LABELS[m]}
                </option>
              ))}
              {block.marker && block.markerType === 'unsupported' && (
                <option value="unsupported">{MARKER_LABELS.unsupported}</option>
              )}
            </select>
          </div>
          {block.marker ? (
            <div className="rounded-md border border-warning/30 bg-warning/15 px-3 py-2 text-xs text-warning">
              Dynamic content: <strong>{MARKER_LABELS[block.markerType ?? 'unsupported']}</strong>.
              {block.markerType === 'unsupported'
                ? ' No equivalent in this app — emits nothing.'
                : ' Filled in automatically at generation time from the story.'}
            </div>
          ) : (
            <textarea
              value={block.content}
              onChange={(e) => onChange({ content: e.target.value })}
              rows={8}
              className="w-full rounded-md border border-ink-200 px-2 py-1 text-sm font-mono resize-y"
              placeholder="Block content. Supports {{char}} and {{user}} placeholders."
            />
          )}
        </div>
      )}
    </li>
  )
}

function PresetEditor({
  workspace,
  preset
}: {
  workspace: string
  preset: Preset
}): React.JSX.Element {
  const { save, delete: deletePreset, exportPreset } = usePresets()
  const { settings, setActivePresetId } = useSettings()
  const [draft, setDraft] = useState<Preset>(preset)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const initializedFor = useRef<string | null>(null)

  // Initialize draft on preset switch only — never overwrite while editing.
  useEffect(() => {
    if (initializedFor.current !== preset.id) {
      initializedFor.current = preset.id
      setDraft(preset)
      setNotice(null)
    }
  }, [preset.id, preset])

  // Compare only editable content — NOT created_at/updated_at, which savePreset bumps on every save
  // (otherwise the button would never return to "Saved" after a successful save).
  const dirty =
    draft.name !== preset.name ||
    JSON.stringify(draft.blocks) !== JSON.stringify(preset.blocks)
  const isActive = settings?.activePresetId === preset.id

  const updateBlock = (id: string, patch: Partial<PromptBlock>): void => {
    setDraft({ ...draft, blocks: draft.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  }
  const moveBlock = (id: string, dir: -1 | 1): void => {
    const idx = draft.blocks.findIndex((b) => b.id === id)
    const next = idx + dir
    if (next < 0 || next >= draft.blocks.length) return
    const blocks = draft.blocks.slice()
    ;[blocks[idx], blocks[next]] = [blocks[next], blocks[idx]]
    setDraft({ ...draft, blocks })
  }
  const addBlock = (): void => {
    setDraft({
      ...draft,
      blocks: [
        ...draft.blocks,
        {
          id: newBlockId(),
          name: 'New block',
          role: 'system',
          content: '',
          marker: false,
          markerType: null,
          enabled: true
        }
      ]
    })
  }

  const onSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await save(workspace, draft)
    } finally {
      setSaving(false)
    }
  }

  const onExport = async (): Promise<void> => {
    const path = await exportPreset(workspace, preset.id)
    if (path) setNotice(`Exported to ${path}`)
  }

  const onDelete = async (): Promise<void> => {
    if (!(await askConfirm(`Delete preset "${preset.name}"?`))) return
    if (isActive) await setActivePresetId(workspace, null)
    await deletePreset(workspace, preset.id)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-surface px-4 py-3">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold focus:outline-none focus:border-ink-200 focus:ring-2 focus:ring-accent-500"
        />
        <button
          type="button"
          onClick={() => setActivePresetId(workspace, isActive ? null : preset.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium border ${
            isActive
              ? 'border-accent-500 bg-accent-500 text-white'
              : 'border-ink-200 text-ink-700 hover:bg-ink-100'
          }`}
          title="The workspace-wide default preset for new generations"
        >
          {isActive ? '★ Active' : 'Set active'}
        </button>
        <button
          type="button"
          onClick={onExport}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
        >
          Export…
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-md bg-accent-500 px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {notice && (
        <div className="border-b border-success/30 bg-success/12 px-4 py-2 text-sm text-success break-all">
          {notice}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <ul>
          {draft.blocks.map((b, i) => (
            <BlockRow
              key={b.id}
              block={b}
              isFirst={i === 0}
              isLast={i === draft.blocks.length - 1}
              onToggle={() => updateBlock(b.id, { enabled: !b.enabled })}
              onChange={(patch) => updateBlock(b.id, patch)}
              onDelete={() =>
                setDraft({ ...draft, blocks: draft.blocks.filter((x) => x.id !== b.id) })
              }
              onMove={(dir) => moveBlock(b.id, dir)}
            />
          ))}
        </ul>
        <div className="p-3">
          <button
            type="button"
            onClick={addBlock}
            className="w-full rounded-md border border-dashed border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
          >
            + Add block
          </button>
        </div>
        <div className="px-4 pb-6 text-xs text-ink-700">
          Each enabled block is sent as a separate entry in the API request, using its role. System
          blocks become the system prompt; user/assistant blocks become messages. Dynamic (marker)
          blocks are filled from the story at generation time.
        </div>
      </div>
    </div>
  )
}

export function PresetsView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { presets, selectedId, load, create, importPreset, select } = usePresets()
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettings()

  useEffect(() => {
    load(workspace)
    if (!settingsLoaded) loadSettings(workspace)
  }, [workspace])

  const selected = presets.find((p) => p.id === selectedId) ?? null

  return (
    <div className="grid h-full grid-cols-[18rem_1fr]">
      <aside className="flex h-full flex-col border-r border-ink-200 bg-ink-50">
        <div className="p-3 border-b border-ink-200 flex gap-2">
          <button
            type="button"
            onClick={() => create(workspace, 'New preset')}
            className="flex-1 rounded-md bg-accent-500 px-3 py-2 text-white text-sm font-medium hover:bg-accent-600"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => importPreset(workspace)}
            className="flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm font-medium hover:bg-ink-100"
          >
            Import…
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {presets.length === 0 && (
            <li className="p-4 text-sm text-ink-700">
              No presets yet. Create one or import a SillyTavern preset JSON.
            </li>
          )}
          {presets.map((p) => {
            const isActive = settings?.activePresetId === p.id
            const enabledCount = p.blocks.filter((b) => b.enabled).length
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-100 ${
                    p.id === selectedId ? 'bg-ink-100' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink-900">{p.name}</div>
                    <div className="text-xs text-ink-700">
                      {enabledCount}/{p.blocks.length} blocks enabled
                    </div>
                  </div>
                  {isActive && <span className="text-xs text-accent-500">★</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
      <main className="overflow-hidden">
        {selected ? (
          <PresetEditor workspace={workspace} preset={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-700">
            Select a preset, or create / import one.
          </div>
        )}
      </main>
    </div>
  )
}
