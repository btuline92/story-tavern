import { useEffect, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { usePresets } from '../stores/presets'
import { useStories } from '../stores/stories'
import { useWorkspace } from '../stores/workspace'

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
  const [characterId, setCharacterId] = useState<string>('')
  const [presetId, setPresetId] = useState<string>('')
  const [premise, setPremise] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setCharacterId('')
      setPresetId('')
      setPremise('')
      setError(null)
      loadChars(workspace)
      loadPresets(workspace)
    }
  }, [open, workspace])

  if (!open) return null

  const canCreate = title.trim().length > 0 && !!characterId

  const onCreate = async (): Promise<void> => {
    if (!canCreate) {
      setError('Title and character are required.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await create(workspace, {
        title: title.trim(),
        characterId,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[32rem] max-w-[90vw] rounded-lg bg-white shadow-xl border border-ink-200 p-6">
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
          Character
        </label>
        <select
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
          className="w-full rounded-md border border-ink-200 px-3 py-2 mb-4 bg-white"
        >
          <option value="">— Select a character —</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {characters.length === 0 && (
          <div className="text-xs text-ink-700 -mt-3 mb-4">
            No characters yet. Create or import one first.
          </div>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
          Preset (optional)
        </label>
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="w-full rounded-md border border-ink-200 px-3 py-2 mb-4 bg-white"
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
