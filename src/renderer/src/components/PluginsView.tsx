import { useEffect, useRef, useState } from 'react'
import { usePlugins } from '../stores/plugins'
import { useWorkspace } from '../stores/workspace'

interface Draft {
  name: string
  content: string
}

export function PluginsView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { plugins, selectedId, load, create, save, delete: remove, select } = usePlugins()
  const selected = plugins.find((p) => p.id === selectedId) ?? null

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    load(workspace)
  }, [workspace, load])

  // Initialize the draft only when the selected plugin changes (guarded, like the other editors).
  useEffect(() => {
    if (!selected) {
      setDraft(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== selected.id) {
      initializedFor.current = selected.id
      setDraft({ name: selected.name, content: selected.content })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const dirty =
    !!selected && !!draft && (draft.name !== selected.name || draft.content !== selected.content)

  const onNew = async (): Promise<void> => {
    await create(workspace, 'New plugin')
  }
  const onSave = async (): Promise<void> => {
    if (!selected || !draft) return
    setSaving(true)
    try {
      await save(workspace, { ...selected, ...draft })
    } finally {
      setSaving(false)
    }
  }
  const onDelete = (): void => {
    if (selected && confirm(`Delete plugin "${selected.name}"?`)) remove(workspace, selected.id)
  }
  const onDiscard = (): void => {
    if (selected) setDraft({ name: selected.name, content: selected.content })
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-col border-r border-ink-200 bg-ink-50">
        <div className="border-b border-ink-200 p-3">
          <button type="button" onClick={onNew} className="st-btn st-btn-sm st-btn-default w-full">
            + New plugin
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {plugins.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => select(p.id)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  p.id === selectedId ? 'bg-ink-100 text-ink-900' : 'text-ink-900 hover:bg-ink-100'
                }`}
              >
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-ink-700 truncate">
                  {p.content.trim().slice(0, 60) || 'Empty'}
                </div>
              </button>
            </li>
          ))}
          {plugins.length === 0 && (
            <li className="px-3 py-4 text-xs text-ink-700">No plugins yet.</li>
          )}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!selected || !draft ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-ink-700">
            <div className="max-w-md">
              Select a plugin, or create one. Plugins are reusable snippets appended to the system
              prompt — switch them on per story to emphasize a kind of content, keeping your presets
              generic.
            </div>
          </div>
        ) : (
          <div className="max-w-3xl p-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs text-ink-700">{dirty ? '• unsaved' : 'saved'}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onDelete}
                  className="st-btn st-btn-sm st-btn-default"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={onDiscard}
                  disabled={!dirty}
                  className="st-btn st-btn-sm st-btn-default"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!dirty || saving}
                  className="st-btn st-btn-sm st-btn-primary"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <label className="st-label">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="st-input w-full mb-4"
            />

            <label className="st-label">System-prompt text</label>
            <textarea
              value={draft.content}
              rows={16}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="e.g. Emphasize slow-burn tension — favor sensory detail and subtext over exposition."
              className="st-textarea w-full"
            />
            <div className="mt-2 text-xs text-ink-700">
              Appended to the end of the system prompt for any story that enables this plugin.{' '}
              {'{{char}}'} and {'{{user}}'} macros are supported.
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
