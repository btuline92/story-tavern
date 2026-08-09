import type { Character } from '../types'
import {
  collectTags,
  isFilterActive,
  EMPTY_FILTER,
  type CharacterFilter,
  type GenderFilter
} from '../lib/characterFilter'

interface Props {
  characters: Character[]
  value: CharacterFilter
  onChange: (next: CharacterFilter) => void
}

const GENDERS: { id: GenderFilter; label: string }[] = [
  { id: 'all', label: 'All genders' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'untagged', label: 'Untagged' }
]

/** Search box + gender select + toggleable tag chips. Controlled by the parent. */
export function CharacterFilterBar({ characters, value, onChange }: Props): React.JSX.Element {
  const tags = collectTags(characters)
  const active = isFilterActive(value)

  const toggleTag = (tag: string): void => {
    const has = value.tags.includes(tag)
    onChange({ ...value, tags: has ? value.tags.filter((t) => t !== tag) : [...value.tags, tag] })
  }

  return (
    <div className="border-b border-ink-200 p-3 flex flex-col gap-2">
      <input
        type="text"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        placeholder="Search name or tag…"
        className="w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      <div className="flex items-center gap-2">
        <select
          value={value.gender}
          onChange={(e) => onChange({ ...value, gender: e.target.value as GenderFilter })}
          className="flex-1 rounded-md border border-ink-200 bg-surface px-2 py-1 text-sm"
        >
          {GENDERS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-100"
          >
            Clear
          </button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {tags.map((t) => {
            const on = value.tags.includes(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  on ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
                }`}
              >
                {t}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
