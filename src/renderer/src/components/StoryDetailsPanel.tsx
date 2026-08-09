import { useEffect, useRef, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { usePresets } from '../stores/presets'
import { usePlugins } from '../stores/plugins'
import { useStories } from '../stores/stories'
import { CharacterPicker } from './CharacterPicker'

interface DraftMeta {
  title: string
  characterIds: string[]
  presetId: string | null
  pluginIds: string[]
  premise: string
}

interface Props {
  workspace: string
}

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: SectionProps): React.JSX.Element {
  return (
    <details open={defaultOpen} className="border-b border-ink-200 group">
      <summary className="flex items-center justify-between cursor-pointer select-none px-4 py-3 hover:bg-ink-50">
        <span className="text-sm font-semibold text-ink-900">{title}</span>
        <span className="text-ink-700 text-xs transition-transform group-open:rotate-90">▶</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
      {children}
    </label>
  )
}

export function StoryDetailsPanel({ workspace }: Props): React.JSX.Element | null {
  const { active, updateMeta } = useStories()
  const { characters, load: loadChars } = useCharacters()
  const { presets, load: loadPresets } = usePresets()
  const { plugins, load: loadPlugins } = usePlugins()

  const [draft, setDraft] = useState<DraftMeta | null>(null)
  const [saving, setSaving] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks which story id we've initialized drafts for. Only changes drive a re-init.
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    loadChars(workspace)
    loadPresets(workspace)
    loadPlugins(workspace)
  }, [workspace])

  // Initialize drafts ONLY when the active story id changes (or active goes null).
  // After init, drafts are entirely user-owned — we never sync from active.meta again.
  // This eliminates the autosave-vs-sync race that has bitten us repeatedly.
  useEffect(() => {
    if (!active) {
      setDraft(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== active.meta.id) {
      initializedFor.current = active.meta.id
      setDraft({
        title: active.meta.title,
        characterIds: active.meta.character_ids,
        presetId: active.meta.preset_id,
        pluginIds: active.meta.plugin_ids,
        premise: active.meta.premise
      })
    }
  }, [active?.meta.id])

  const dirty =
    !!active &&
    !!draft &&
    (draft.title !== active.meta.title ||
      JSON.stringify(draft.characterIds) !== JSON.stringify(active.meta.character_ids) ||
      draft.presetId !== active.meta.preset_id ||
      JSON.stringify(draft.pluginIds) !== JSON.stringify(active.meta.plugin_ids) ||
      draft.premise !== active.meta.premise)

  // Debounced autosave: drafts are the source of truth; flow is one-way to disk.
  useEffect(() => {
    if (!dirty || !active || !draft) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      void (async () => {
        setSaving(true)
        try {
          await updateMeta(workspace, active.meta.id, {
            title: draft.title,
            characterIds: draft.characterIds,
            presetId: draft.presetId,
            pluginIds: draft.pluginIds,
            premise: draft.premise
          })
        } finally {
          setSaving(false)
        }
      })()
    }, 1500)
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft?.title, draft?.characterIds, draft?.presetId, draft?.pluginIds, draft?.premise])

  if (!active || !draft) return null

  const setField = <K extends keyof DraftMeta>(key: K, value: DraftMeta[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 bg-surface px-4 py-3">
        <div className="text-sm font-semibold text-ink-900">Story setup</div>
        <div className="text-xs text-ink-700">
          {saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Core">
          <div>
            <Label>Title</Label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setField('title', e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <div className="text-xs text-ink-700 mt-1">
              Renaming will move the story folder on save.
            </div>
          </div>
          <div>
            <Label>Characters</Label>
            <CharacterPicker
              characters={characters}
              selectedIds={draft.characterIds}
              heightClass="max-h-60"
              filterable
              onToggle={(id) =>
                setField(
                  'characterIds',
                  draft.characterIds.includes(id)
                    ? draft.characterIds.filter((x) => x !== id)
                    : [...draft.characterIds, id]
                )
              }
            />
            <div className="text-xs text-ink-700 mt-1">
              All selected characters are sent to story generation and the image tagger.
            </div>
          </div>
          <div>
            <Label>Preset</Label>
            <select
              value={draft.presetId ?? ''}
              onChange={(e) => setField('presetId', e.target.value || null)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm bg-surface"
            >
              <option value="">— Workspace default —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="text-xs text-ink-700 mt-1">
              Which prompt preset to use for this story. Falls back to the workspace active preset,
              then a built-in default.
            </div>
          </div>
        </Section>

        <Section title="Plugins" defaultOpen={false}>
          {plugins.length === 0 ? (
            <div className="text-xs text-ink-700">
              No plugins yet. Create reusable system-prompt decorators in the Plugins tab.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-md border border-ink-200">
              {plugins.map((p) => (
                <label
                  key={p.id}
                  className="flex items-start gap-2 px-3 py-1.5 hover:bg-ink-100 cursor-pointer border-b border-ink-100 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={draft.pluginIds.includes(p.id)}
                    onChange={() =>
                      setField(
                        'pluginIds',
                        draft.pluginIds.includes(p.id)
                          ? draft.pluginIds.filter((x) => x !== p.id)
                          : [...draft.pluginIds, p.id]
                      )
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-900">{p.name}</div>
                    <div className="truncate text-xs text-ink-700">
                      {p.content.trim().slice(0, 60) || 'Empty'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="text-xs text-ink-700 mt-1">
            Enabled plugins are appended to the end of the system prompt for this story.
          </div>
        </Section>

        <Section title="Premise">
          <div>
            <Label>Story premise</Label>
            <textarea
              value={draft.premise}
              onChange={(e) => setField('premise', e.target.value)}
              rows={10}
              placeholder="What is this story about? Set the situation, stakes, mood, and any constraints. This goes into the system prompt at generation time."
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
            />
          </div>
        </Section>

        {/*
          Add more sections here as the story-config schema grows:
            <Section title="Style" defaultOpen={false}>...</Section>
            <Section title="Plot" defaultOpen={false}>...</Section>
            <Section title="Worldbuilding" defaultOpen={false}>...</Section>
            <Section title="Generation overrides" defaultOpen={false}>...</Section>
        */}
      </div>
    </div>
  )
}
