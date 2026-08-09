import { useState } from 'react'

/** A controlled string[] tag editor: comma/Enter to commit, backspace to remove the last, pills with ×. */
export function TagsEditor({
  value,
  onChange,
  label = 'Tags'
}: {
  value: string[]
  onChange: (v: string[]) => void
  label?: string
}): React.JSX.Element {
  const [input, setInput] = useState('')

  const add = (raw: string): void => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (parts.length === 0) return
    const next = [...value]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setInput('')
  }

  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        {label}
      </label>
      <div className="rounded-md border border-ink-200 bg-surface p-2 flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-ink-700 hover:text-ink-900"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(input)
            } else if (e.key === 'Backspace' && !input && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => input.trim() && add(input)}
          placeholder={value.length === 0 ? 'Add tags (comma or Enter to commit)' : ''}
          className="flex-1 min-w-[10rem] text-sm focus:outline-none bg-transparent"
        />
      </div>
    </div>
  )
}
