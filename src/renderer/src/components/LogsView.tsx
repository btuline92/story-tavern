import { useEffect, useMemo, useState } from 'react'
import { useLogs } from '../stores/logs'
import { useWorkspace } from '../stores/workspace'
import type { ApiLogEntry } from '../types'

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(2)} s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(0)}s`
}

/** Pretty-print a body if it parses as JSON; otherwise return it unchanged. */
function pretty(s: string): string {
  const t = s.trimStart()
  if (!t.startsWith('{') && !t.startsWith('[')) return s
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function StatusBadge({ entry }: { entry: ApiLogEntry }): React.JSX.Element {
  const isError = entry.error != null || (entry.status != null && entry.status >= 400)
  const isOk = entry.status != null && entry.status >= 200 && entry.status < 300
  let cls = 'bg-ink-100 text-ink-700'
  let text = entry.status != null ? String(entry.status) : '—'
  if (isError) {
    cls = 'bg-danger/15 text-danger'
    text = entry.status != null ? String(entry.status) : 'ERR'
  } else if (isOk) {
    cls = 'bg-success/15 text-success'
  }
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${cls}`}>{text}</span>
  )
}

function LogRow({ entry }: { entry: ApiLogEntry }): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<ApiLogEntry | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)

  // Fetch the full request/response bodies the first time the row is expanded
  // (the list only carries previews to stay light).
  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next && !full && !loadingFull) {
      setLoadingFull(true)
      window.api.logs
        .get(workspace, entry.id)
        .then((e) => {
          if (e) setFull(e)
        })
        .catch(() => {})
        .finally(() => setLoadingFull(false))
    }
  }

  const reqBody = full?.request_body ?? entry.request_body_preview
  const resBody = full?.response_body ?? entry.response_body_preview

  return (
    <li className="border-b border-ink-200">
      <button
        type="button"
        onClick={toggle}
        className="w-full text-left px-4 py-2 hover:bg-ink-50 flex items-center gap-3"
      >
        <span className="text-xs text-ink-700 font-mono tabular-nums whitespace-nowrap w-44">
          {new Date(entry.ts).toLocaleString()}
        </span>
        <StatusBadge entry={entry} />
        <span className="text-xs font-semibold text-ink-900 w-24 truncate">{entry.provider}</span>
        <span className="text-xs text-ink-700 w-32 truncate">{entry.kind}</span>
        <span className="text-xs text-ink-700 truncate flex-1">
          {entry.model ?? '—'}
          {entry.error && <span className="text-danger"> · {entry.error.slice(0, 80)}</span>}
        </span>
        <span className="text-xs text-ink-700 tabular-nums whitespace-nowrap">
          {fmtDuration(entry.duration_ms)}
          {entry.stream_chunks != null && ` · ${entry.stream_chunks} chunks`}
        </span>
      </button>
      {open && (
        <div className="bg-ink-50 px-4 py-3 text-xs font-mono space-y-3">
          <div>
            <div className="text-ink-700 mb-1">URL</div>
            <div className="break-all text-ink-900">{entry.url || '—'}</div>
          </div>
          {reqBody && (
            <div>
              <div className="text-ink-700 mb-1">
                Request ({entry.request_body_size.toLocaleString()} chars)
                {loadingFull && !full && <span className="ml-2 italic">loading full…</span>}
              </div>
              <pre className="whitespace-pre-wrap break-words text-ink-900 bg-surface border border-ink-200 rounded p-2 max-h-96 overflow-auto">
                {pretty(reqBody)}
              </pre>
            </div>
          )}
          {resBody && (
            <div>
              <div className="text-ink-700 mb-1">
                Response ({entry.response_body_size.toLocaleString()} chars)
                {loadingFull && !full && <span className="ml-2 italic">loading full…</span>}
              </div>
              <pre className="whitespace-pre-wrap break-words text-ink-900 bg-surface border border-ink-200 rounded p-2 max-h-96 overflow-auto">
                {pretty(resBody)}
              </pre>
            </div>
          )}
          {entry.error && (
            <div>
              <div className="text-danger mb-1">Error</div>
              <pre className="whitespace-pre-wrap break-words text-danger bg-danger/12 border border-danger/30 rounded p-2">
                {entry.error}
              </pre>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ink-200">
            {entry.story_id && <div>story_id: {entry.story_id}</div>}
            {entry.chapter_number != null && <div>chapter: {entry.chapter_number}</div>}
            <div>id: {entry.id}</div>
          </div>
        </div>
      )}
    </li>
  )
}

export function LogsView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { entries, load, prepend, reveal } = useLogs()
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [kindFilter, setKindFilter] = useState<string>('')
  const [onlyErrors, setOnlyErrors] = useState(false)

  useEffect(() => {
    load(workspace)
    const off = window.api.logs.onAppended((entry) => prepend(entry))
    return off
  }, [workspace])

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (providerFilter && e.provider !== providerFilter) return false
      if (kindFilter && e.kind !== kindFilter) return false
      if (onlyErrors && !e.error && (e.status == null || e.status < 400)) return false
      return true
    })
  }, [entries, providerFilter, kindFilter, onlyErrors])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-ink-200 bg-surface px-6 py-3">
        <h2 className="text-lg font-semibold text-ink-900">API logs</h2>
        <div className="flex-1" />
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-sm"
        >
          <option value="">All providers</option>
          <option value="anthropic">anthropic</option>
          <option value="openai">openai</option>
          <option value="openrouter">openrouter</option>
          <option value="deepseek">deepseek</option>
          <option value="nanogpt">nanogpt</option>
          <option value="featherless">featherless</option>
          <option value="comfyui">comfyui</option>
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-sm"
        >
          <option value="">All kinds</option>
          <option value="test">test</option>
          <option value="list-models">list-models</option>
          <option value="continue">continue</option>
          <option value="continue-stream">continue-stream</option>
          <option value="plan-beats">plan-beats</option>
          <option value="suggest-outlines">suggest-outlines</option>
          <option value="create-character">create-character</option>
          <option value="image-tags">image-tags</option>
          <option value="image-generate">image-generate</option>
          <option value="summarize">summarize</option>
          <option value="rewrite">rewrite</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-ink-900">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
          />
          Errors only
        </label>
        <button
          type="button"
          onClick={() => load(workspace)}
          className="rounded-md border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => reveal(workspace)}
          className="rounded-md border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
        >
          Reveal in Explorer
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-ink-700">
            {entries.length === 0
              ? 'No API activity logged yet. Make a request (Test connection, list models, or Continue) and it will appear here.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          <ul>
            {filtered.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
