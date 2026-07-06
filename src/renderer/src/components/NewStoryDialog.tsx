import { useEffect, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { usePresets } from '../stores/presets'
import { useStories } from '../stores/stories'
import { useWorkspace } from '../stores/workspace'
import { CharacterPicker } from './CharacterPicker'

interface Props {
  open: boolean
  onClose: () => void
}

export function NewStoryDialog({ open, onClose }: Props): React.JSX.Element | null {
  const workspace = useWorkspace((s) => s.path)!
  const { characters, load: loadChars } = useCharacters()
  const { presets, load: loadPresets } = usePresets()
  const create = useStories((s) => s.create)

  const [title, setTitle] = useState('')
  const [characterIds, setCharacterIds] = useState<string[]>([])
  const [presetId, setPresetId] = useState<string>('')
  const [premise, setPremise] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setCharacterIds([])
      setPresetId('')
      setPremise('')
      setError(null)
      loadChars(workspace)
      loadPresets(workspace)
    }
  }, [open, workspace])

  if (!open) return null

  const canCreate = title.trim().length > 0 && characterIds.length > 0
  const toggleChar = (id: string): void =>
    setCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const onCreate = async (): Promise<void> => {
    if (!canCreate) {
      setError('Title and at least one character are required.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await create(workspace, {
        title: title.trim(),
        characterIds,
        presetId: presetId || null,
        premise: premise.trim()
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-[46rem] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-lg bg-surface shadow-xl border border-ink-200 p-6">
        <h3 className="text-xl font-semibold text-ink-900 mb-4">Start a new story</h3>

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="The Crooked Lantern"
          autoFocus
          className="w-full rounded-md border border-ink-200 px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Characters
        </label>
        <div className="mb-4">
          <CharacterPicker
            characters={characters}
            selectedIds={characterIds}
            onToggle={toggleChar}
          />
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Preset (optional)
        </label>
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="w-full rounded-md border border-ink-200 px-3 py-2 mb-4 bg-surface"
        >
          <option value="">— Workspace default —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Premise (optional — you can edit later)
        </label>
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          rows={4}
          placeholder="A rainy night at the Crooked Lantern. A stranger arrives with mud on her boots and a question Misty doesn't want to answer."
          className="w-full rounded-md border border-ink-200 px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 resize-y"
        />

        {error && <div className="text-sm text-red-700 mb-3">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={!canCreate || creating}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white font-medium hover:bg-accent-600 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Start writing'}
          </button>
        </div>
      </div>
    </div>
  )
}
