import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import type { ModelInfo, ProviderId } from '../types'

interface Props {
  provider: ProviderId
  value: string
  hasKey: boolean
  onChange: (model: string) => void
}

function rankMatch(query: string, candidate: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  if (c === q) return 0
  if (c.startsWith(q)) return 1
  const idx = c.indexOf(q)
  if (idx >= 0) return 2 + idx
  return -1
}

export function ModelSelect({ provider, value, hasKey, onChange }: Props): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Keep input in sync if external value changes (e.g. on provider switch / load)
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const fetchModels = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.providers.listModels(
        provider,
        undefined,
        workspace ?? undefined
      )
      setModels(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Auto-fetch when opened (or when provider changes if currently open)
  useEffect(() => {
    if (open && models.length === 0 && !loading && !error) {
      fetchModels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  const filtered = useMemo(() => {
    if (models.length === 0) return []
    const q = query.trim()
    if (!q) {
      return models.slice(0, 200)
    }
    return models
      .map((m) => ({ m, score: rankMatch(q, m.id) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.m.id.localeCompare(b.m.id))
      .slice(0, 200)
      .map((x) => x.m)
  }, [models, query])

  const commit = (model: string): void => {
    onChange(model)
    setQuery(model)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered[highlightIdx]) {
        commit(filtered[highlightIdx].id)
      } else {
        commit(query)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery(value)
    }
  }

  const onBlur = (): void => {
    // Commit free-form text if user has typed something different and dropdown is closed
    setTimeout(() => {
      if (!open && query !== value) onChange(query)
    }, 100)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlightIdx(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder="Model id…"
          className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            fetchModels()
          }}
          disabled={loading}
          title={hasKey ? 'Refresh model list' : 'Set API key to fetch (or type a model id)'}
          className="rounded-md border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100 disabled:opacity-50"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white shadow-lg">
          {loading && <div className="px-3 py-2 text-sm text-ink-700">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-700">
              {models.length === 0
                ? hasKey
                  ? 'Click ↻ to fetch model list'
                  : 'Save an API key first, or type any model id'
                : 'No matches — press Enter to use as custom model id'}
            </div>
          )}
          {filtered.map((m, idx) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                commit(m.id)
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`block w-full text-left px-3 py-1.5 text-sm font-mono ${
                idx === highlightIdx ? 'bg-ink-100' : ''
              } hover:bg-ink-100`}
            >
              <span className="text-ink-900">{m.id}</span>
              {m.description && (
                <span className="ml-2 text-xs text-ink-700 font-sans">{m.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
