import type { Character } from '../types'

interface Props {
  characters: Character[]
  selectedIds: string[]
  onToggle: (id: string) => void
  /** Tailwind max-height class for the scroll area (defaults to a roomy list). */
  heightClass?: string
}

/** A scrollable multi-select list of characters, showing each character's tags. */
export function CharacterPicker({
  characters,
  selectedIds,
  onToggle,
  heightClass = 'max-h-72'
}: Props): React.JSX.Element {
  if (characters.length === 0) {
    return (
      <div className="text-xs text-ink-700">No characters yet. Create or import one first.</div>
    )
  }
  return (
    <div className={`${heightClass} overflow-y-auto rounded-md border border-ink-200`}>
      {characters.map((c) => {
        const tags = c.tavern_data?.tags ?? []
        return (
          <label
            key={c.id}
            className="flex items-start gap-2 px-3 py-1.5 hover:bg-ink-50 cursor-pointer border-b border-ink-100 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(c.id)}
              onChange={() => onToggle(c.id)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink-900">{c.name}</div>
              {tags.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </label>
        )
      })}
    </div>
  )
}
