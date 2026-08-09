import { useEffect, useMemo, useRef, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { useWorkspace } from '../stores/workspace'
import { askConfirm } from '../stores/dialog'
import type { Character } from '../types'
import { TagsEditor } from './TagsEditor'

interface DraftFields {
  name: string
  creator: string
  character_version: string
  tags: string[]
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  appearance_tags: string
  image_negative_tags: string
}

interface StoryTavernImageExt {
  appearance_tags?: string
  negative_tags?: string
}

function imageExt(c: Character): StoryTavernImageExt {
  const block = (c.tavern_data.extensions as Record<string, unknown> | undefined)?.story_tavern
  return (block ?? {}) as StoryTavernImageExt
}

function draftFrom(c: Character): DraftFields {
  const img = imageExt(c)
  return {
    name: c.name,
    creator: c.tavern_data.creator,
    character_version: c.tavern_data.character_version,
    tags: [...c.tavern_data.tags],
    description: c.description,
    personality: c.tavern_data.personality,
    scenario: c.tavern_data.scenario,
    first_mes: c.tavern_data.first_mes,
    mes_example: c.tavern_data.mes_example,
    creator_notes: c.tavern_data.creator_notes,
    system_prompt: c.tavern_data.system_prompt,
    post_history_instructions: c.tavern_data.post_history_instructions,
    alternate_greetings: [...c.tavern_data.alternate_greetings],
    appearance_tags: img.appearance_tags ?? '',
    image_negative_tags: img.negative_tags ?? ''
  }
}

function fieldsEqual(a: DraftFields, b: DraftFields): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  size = 'md'
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
}): React.JSX.Element {
  const sizeCls = size === 'lg' ? 'text-2xl font-semibold' : size === 'sm' ? 'text-sm' : 'text-base'
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          {label}
        </label>
      )}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border border-ink-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500 ${sizeCls}`}
      />
    </div>
  )
}

function TextArea({
  label,
  value,
  onChange,
  rows = 6,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}): React.JSX.Element {
  return (
    <div className="mb-6">
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
      />
    </div>
  )
}

function GreetingsEditor({
  value,
  onChange
}: {
  value: string[]
  onChange: (v: string[]) => void
}): React.JSX.Element {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink-700">
          Alternate greetings
        </label>
        <button
          type="button"
          onClick={() => onChange([...value, ''])}
          className="text-xs text-accent-500 hover:text-accent-600"
        >
          + Add
        </button>
      </div>
      {value.length === 0 && (
        <div className="text-xs text-ink-700 italic">No alternate greetings.</div>
      )}
      {value.map((g, i) => (
        <div key={i} className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-ink-700">#{i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="text-xs text-ink-700 hover:text-danger"
            >
              Remove
            </button>
          </div>
          <textarea
            value={g}
            rows={3}
            onChange={(e) => {
              const next = value.slice()
              next[i] = e.target.value
              onChange(next)
            }}
            className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
          />
        </div>
      ))}
    </div>
  )
}

export function CharacterDetail(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { characters, selectedId, update, pickAvatar, exportCard, remove } = useCharacters()
  const character = characters.find((c) => c.id === selectedId) ?? null

  const [draft, setDraft] = useState<DraftFields | null>(null)
  const [saving, setSaving] = useState(false)
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  // Tracks which character id the draft was initialized for. Only an id change re-inits.
  const initializedFor = useRef<string | null>(null)

  // Initialize the draft ONLY when the selected character changes — never re-sync from the
  // character object afterward. Saving (and renaming) reloads the characters list and hands us
  // a new character object with the same id; re-syncing then would overwrite the user's draft
  // mid-edit and make the inputs feel frozen. This mirrors the guarded pattern the story
  // editors use to avoid the sync-vs-edit race.
  useEffect(() => {
    if (!character) {
      setDraft(null)
      setExportNotice(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== character.id) {
      initializedFor.current = character.id
      setDraft(draftFrom(character))
      setExportNotice(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id])

  // Load avatar
  useEffect(() => {
    setAvatarSrc(null)
    if (character?.avatar) {
      window.api.characters
        .readAvatar(workspace, character.avatar)
        .then(setAvatarSrc)
        .catch(() => {})
    }
  }, [workspace, character?.id, character?.avatar])

  const dirty = useMemo(() => {
    if (!character || !draft) return false
    return !fieldsEqual(draft, draftFrom(character))
  }, [character, draft])

  if (!character || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-ink-700">
        Select a character to view or edit, or create a new one
      </div>
    )
  }

  const set = <K extends keyof DraftFields>(key: K, value: DraftFields[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  const onSave = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      await update(workspace, character.id, {
        name: draft.name,
        description: draft.description,
        tavern_data: {
          personality: draft.personality,
          scenario: draft.scenario,
          first_mes: draft.first_mes,
          mes_example: draft.mes_example,
          creator_notes: draft.creator_notes,
          system_prompt: draft.system_prompt,
          post_history_instructions: draft.post_history_instructions,
          alternate_greetings: draft.alternate_greetings,
          tags: draft.tags,
          creator: draft.creator,
          character_version: draft.character_version,
          extensions: {
            story_tavern: {
              appearance_tags: draft.appearance_tags,
              negative_tags: draft.image_negative_tags
            }
          }
        }
      })
    } finally {
      setSaving(false)
    }
  }

  const onDiscard = (): void => {
    setDraft(draftFrom(character))
  }

  const onReplaceAvatar = async (): Promise<void> => {
    await pickAvatar(workspace, character.id)
  }

  const onExport = async (): Promise<void> => {
    setExportNotice(null)
    const path = await exportCard(workspace, character.id, draft.name || character.slug)
    if (path) setExportNotice(`Exported to ${path}`)
  }

  const onDelete = async (): Promise<void> => {
    if (
      await askConfirm(`Delete "${character.name}"? This removes the markdown file and avatar.`)
    ) {
      remove(workspace, character.id)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 bg-surface px-6 py-3">
        <div className="text-xs text-ink-700 truncate">
          {character.slug}.md {dirty && <span className="ml-2 text-accent-500">• unsaved</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExport}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          >
            Export as Tavern card…
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
            onClick={onDiscard}
            disabled={!dirty}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex items-start gap-6 mb-6">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={character.name}
              className="h-32 w-32 rounded-lg object-cover bg-ink-200"
            />
          ) : (
            <div className="h-32 w-32 rounded-lg bg-ink-200 flex items-center justify-center text-ink-700 font-semibold text-3xl">
              {(draft.name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <TextField
              label=""
              value={draft.name}
              onChange={(v) => set('name', v)}
              placeholder="Character name"
              size="lg"
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <TextField
                  label="Creator"
                  value={draft.creator}
                  onChange={(v) => set('creator', v)}
                  size="sm"
                />
              </div>
              <div className="w-32">
                <TextField
                  label="Version"
                  value={draft.character_version}
                  onChange={(v) => set('character_version', v)}
                  size="sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onReplaceAvatar}
              className="text-xs text-accent-500 hover:text-accent-600"
            >
              {character.avatar ? 'Replace avatar…' : 'Set avatar…'}
            </button>
          </div>
        </div>

        {exportNotice && (
          <div className="mb-4 rounded-md border border-success/30 bg-success/12 px-3 py-2 text-sm text-success break-all">
            {exportNotice}
          </div>
        )}

        <TagsEditor value={draft.tags} onChange={(v) => set('tags', v)} />

        <TextArea
          label="Description"
          value={draft.description}
          rows={10}
          onChange={(v) => set('description', v)}
        />
        <TextArea
          label="Personality"
          value={draft.personality}
          rows={4}
          onChange={(v) => set('personality', v)}
        />
        <TextArea
          label="Scenario"
          value={draft.scenario}
          rows={4}
          onChange={(v) => set('scenario', v)}
        />

        <div className="mb-6 rounded-lg border border-ink-200 bg-ink-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-700 mb-2">
            Image generation
          </div>
          <TextArea
            label="Appearance tags (Danbooru, reproduced for visual consistency)"
            value={draft.appearance_tags}
            rows={3}
            placeholder="e.g. blonde hair, blue eyes, elf ears, long hair, freckles,"
            onChange={(v) => set('appearance_tags', v)}
          />
          <div className="-mb-2">
            <TextArea
              label="Per-character negative tags (optional)"
              value={draft.image_negative_tags}
              rows={2}
              placeholder="e.g. glasses, hat,"
              onChange={(v) => set('image_negative_tags', v)}
            />
          </div>
        </div>

        <TextArea
          label="First message"
          value={draft.first_mes}
          rows={6}
          onChange={(v) => set('first_mes', v)}
        />
        <TextArea
          label="Message example"
          value={draft.mes_example}
          rows={6}
          onChange={(v) => set('mes_example', v)}
        />

        <GreetingsEditor
          value={draft.alternate_greetings}
          onChange={(v) => set('alternate_greetings', v)}
        />

        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700 mb-2">
            Advanced (creator notes, system prompt, post-history instructions)
          </summary>
          <div className="pt-3">
            <TextArea
              label="Creator notes"
              value={draft.creator_notes}
              rows={3}
              onChange={(v) => set('creator_notes', v)}
            />
            <TextArea
              label="System prompt (card-level override)"
              value={draft.system_prompt}
              rows={4}
              onChange={(v) => set('system_prompt', v)}
            />
            <TextArea
              label="Post-history instructions"
              value={draft.post_history_instructions}
              rows={4}
              onChange={(v) => set('post_history_instructions', v)}
            />
          </div>
        </details>
      </div>
    </div>
  )
}
