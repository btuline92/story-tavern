import { useEffect, useRef, useState } from 'react'
import { useLorebooks } from '../stores/lorebooks'
import { useWorkspace } from '../stores/workspace'
import { askConfirm, showAlert } from '../stores/dialog'
import type { Lorebook, LorebookEntry } from '../types'

const POSITIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Before char' },
  { value: 1, label: 'After char' },
  { value: 4, label: 'At depth' }
]
const LOGICS: { value: number; label: string }[] = [
  { value: 0, label: 'AND ANY' },
  { value: 1, label: 'NOT ALL' },
  { value: 2, label: 'NOT ANY' },
  { value: 3, label: 'AND ALL' }
]

function blankEntry(uid: number): LorebookEntry {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    disable: false,
    selective: true,
    selectiveLogic: 0,
    order: 100,
    position: 0,
    depth: 4,
    role: 0,
    probability: 100,
    useProbability: true,
    caseSensitive: null,
    matchWholeWords: null,
    scanDepth: null,
    excludeRecursion: false,
    preventRecursion: false,
    extensions: {}
  }
}

const csv = (arr: string[]): string => arr.join(', ')
const parseCsv = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function LorebooksView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const {
    lorebooks,
    selectedId,
    load,
    create,
    save,
    delete: remove,
    select,
    import: importLb,
    export: exportLb
  } = useLorebooks()
  const selected = lorebooks.find((l) => l.id === selectedId) ?? null

  const [draft, setDraft] = useState<Lorebook | null>(null)
  const [saving, setSaving] = useState(false)
  const initializedFor = useRef<string | null>(null)

  useEffect(() => {
    load(workspace)
  }, [workspace, load])

  // Init the draft only when the selected lorebook changes (deep copy — entries are edited in place).
  useEffect(() => {
    if (!selected) {
      setDraft(null)
      initializedFor.current = null
      return
    }
    if (initializedFor.current !== selected.id) {
      initializedFor.current = selected.id
      setDraft(JSON.parse(JSON.stringify(selected)) as Lorebook)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  // Ignore created_at/updated_at — saveLorebook bumps updated_at, so comparing them would leave the
  // button permanently "dirty" after a successful save.
  const stamplessJson = (lb: Lorebook): string =>
    JSON.stringify({ ...lb, created_at: '', updated_at: '' })
  const dirty = !!selected && !!draft && stamplessJson(draft) !== stamplessJson(selected)

  const onNew = async (): Promise<void> => {
    await create(workspace, 'New lorebook')
  }
  const onImport = async (): Promise<void> => {
    try {
      await importLb(workspace)
    } catch (e) {
      await showAlert(e instanceof Error ? e.message : 'Import failed.')
    }
  }
  const onSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      await save(workspace, draft)
    } finally {
      setSaving(false)
    }
  }
  const onDelete = async (): Promise<void> => {
    if (selected && (await askConfirm(`Delete lorebook "${selected.name}"?`)))
      remove(workspace, selected.id)
  }
  const onExport = async (): Promise<void> => {
    if (selected) await exportLb(workspace, selected.id)
  }

  const patchEntry = (index: number, patch: Partial<LorebookEntry>): void => {
    if (!draft) return
    const entries = draft.entries.map((e, i) => (i === index ? { ...e, ...patch } : e))
    setDraft({ ...draft, entries })
  }
  const addEntry = (): void => {
    if (!draft) return
    const uid = draft.entries.reduce((m, e) => Math.max(m, e.uid), -1) + 1
    setDraft({ ...draft, entries: [...draft.entries, blankEntry(uid)] })
  }
  const deleteEntry = (index: number): void => {
    if (!draft) return
    setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-col border-r border-ink-200 bg-ink-50">
        <div className="flex gap-2 border-b border-ink-200 p-3">
          <button type="button" onClick={onNew} className="st-btn st-btn-sm st-btn-default flex-1">
            + New
          </button>
          <button
            type="button"
            onClick={onImport}
            className="st-btn st-btn-sm st-btn-default flex-1"
          >
            Import…
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {lorebooks.map((lb) => (
            <li key={lb.id}>
              <button
                type="button"
                onClick={() => select(lb.id)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  lb.id === selectedId ? 'bg-ink-100 text-ink-900' : 'text-ink-900 hover:bg-ink-100'
                }`}
              >
                <div className="font-medium truncate">{lb.name}</div>
                <div className="text-xs text-ink-700">
                  {lb.entries.length} {lb.entries.length === 1 ? 'entry' : 'entries'}
                </div>
              </button>
            </li>
          ))}
          {lorebooks.length === 0 && (
            <li className="px-3 py-4 text-xs text-ink-700">
              No lorebooks yet. Create one, or import a SillyTavern World Info JSON.
            </li>
          )}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!selected || !draft ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-ink-700">
            <div className="max-w-md">
              Select a lorebook, create one, or import a SillyTavern World Info file. Entries inject
              their text into a story&apos;s prompt when one of their keywords appears in the recent
              writing (or always, for constant entries). Attach lorebooks to a story from its Details
              panel.
            </div>
          </div>
        ) : (
          <div className="max-w-4xl p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="st-input min-w-0 flex-1 text-lg font-semibold"
              />
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-ink-700">{dirty ? '• unsaved' : 'saved'}</span>
                <button
                  type="button"
                  onClick={onExport}
                  className="st-btn st-btn-sm st-btn-default"
                >
                  Export…
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="st-btn st-btn-sm st-btn-default"
                >
                  Delete
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

            <div className="space-y-3">
              {draft.entries.map((entry, i) => (
                <div key={i} className="rounded-lg border border-ink-200 bg-surface p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.comment}
                      onChange={(e) => patchEntry(i, { comment: e.target.value })}
                      placeholder="Entry title (comment)"
                      className="st-input min-w-0 flex-1 text-sm font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => deleteEntry(i)}
                      className="shrink-0 rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="st-label">Keys (comma-separated)</label>
                      <input
                        type="text"
                        value={csv(entry.key)}
                        onChange={(e) => patchEntry(i, { key: parseCsv(e.target.value) })}
                        placeholder="dragon, wyrm, /drag[oe]n/i"
                        className="st-input w-full text-sm"
                      />
                    </div>
                    <div>
                      <label className="st-label">Secondary keys</label>
                      <input
                        type="text"
                        value={csv(entry.keysecondary)}
                        onChange={(e) => patchEntry(i, { keysecondary: parseCsv(e.target.value) })}
                        placeholder="optional"
                        className="st-input w-full text-sm"
                      />
                    </div>
                  </div>

                  <label className="st-label mt-2">Content</label>
                  <textarea
                    value={entry.content}
                    rows={4}
                    onChange={(e) => patchEntry(i, { content: e.target.value })}
                    placeholder="Lore text injected when this entry activates. {{char}} / {{user}} supported."
                    className="st-textarea w-full text-sm"
                  />

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-900">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!entry.disable}
                        onChange={(e) => patchEntry(i, { disable: !e.target.checked })}
                        className="h-4 w-4 accent-accent-500"
                      />
                      Enabled
                    </label>
                    <label className="flex items-center gap-1" title="Always active, no keyword needed">
                      <input
                        type="checkbox"
                        checked={entry.constant}
                        onChange={(e) => patchEntry(i, { constant: e.target.checked })}
                        className="h-4 w-4 accent-accent-500"
                      />
                      Constant
                    </label>
                    <label className="flex items-center gap-1" title="Higher inserts first">
                      Order
                      <input
                        type="number"
                        value={entry.order}
                        onChange={(e) => patchEntry(i, { order: Number(e.target.value) || 0 })}
                        className="st-input w-16 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Pos
                      <select
                        value={entry.position}
                        onChange={(e) => patchEntry(i, { position: Number(e.target.value) })}
                        className="st-select text-sm"
                      >
                        {POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      className="flex items-center gap-1"
                      title="How secondary keys combine with a primary match"
                    >
                      Logic
                      <select
                        value={entry.selectiveLogic}
                        onChange={(e) => patchEntry(i, { selectiveLogic: Number(e.target.value) })}
                        className="st-select text-sm"
                      >
                        {LOGICS.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={entry.caseSensitive === true}
                        onChange={(e) => patchEntry(i, { caseSensitive: e.target.checked })}
                        className="h-4 w-4 accent-accent-500"
                      />
                      Case
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={entry.matchWholeWords === true}
                        onChange={(e) => patchEntry(i, { matchWholeWords: e.target.checked })}
                        className="h-4 w-4 accent-accent-500"
                      />
                      Whole word
                    </label>
                    <label className="flex items-center gap-1" title="Percent chance to activate">
                      Prob
                      <input
                        type="number"
                        value={entry.probability}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          patchEntry(i, { probability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
                        }
                        className="st-input w-16 text-sm"
                      />
                    </label>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addEntry}
                className="w-full rounded-md border border-dashed border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
              >
                + Add entry
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
