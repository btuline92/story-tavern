import { useEffect, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { useWorkspace } from '../stores/workspace'
import type { Character } from '../types'
import { AvatarThumb } from './AvatarThumb'
import { CreateWithAiDialog } from './CreateWithAiDialog'

export function CharacterList(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { characters, selectedId, load, importCard, createNew, select } = useCharacters()
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    load(workspace)
  }, [workspace, load])

  return (
    <div className="flex h-full flex-col border-r border-ink-200 bg-ink-50">
      <div className="p-3 border-b border-ink-200 flex gap-2">
        <button
          type="button"
          onClick={() => createNew(workspace)}
          className="flex-1 rounded-md bg-accent-500 px-3 py-2 text-white text-sm font-medium hover:bg-accent-600 transition"
        >
          New
        </button>
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          title="Create a character with AI"
          className="flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-100 transition"
        >
          ✨ AI
        </button>
        <button
          type="button"
          onClick={() => importCard(workspace)}
          className="flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-100 transition"
        >
          Import…
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {characters.length === 0 && (
          <li className="p-4 text-sm text-ink-700">No characters yet. Import a card to begin.</li>
        )}
        {characters.map((c: Character) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => select(c.id)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-100 ${
                c.id === selectedId ? 'bg-ink-100' : ''
              }`}
            >
              <AvatarThumb workspace={workspace} avatar={c.avatar} name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink-900">{c.name}</div>
                {c.tavern_data.creator && (
                  <div className="truncate text-xs text-ink-700">by {c.tavern_data.creator}</div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <CreateWithAiDialog open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
