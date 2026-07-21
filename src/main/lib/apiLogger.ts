import { BrowserWindow } from 'electron'
import { appendFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** How much of each body to keep inline for the log list (full bodies are fetched on demand). */
const PREVIEW_LIMIT = 4000
/** Roll to a new segment file once the active one passes this size. */
const MAX_SEGMENT_BYTES = 8 * 1024 * 1024
/** Total budget for the logs directory; oldest files are pruned past this. */
const MAX_TOTAL_BYTES = 150 * 1024 * 1024

export type ApiLogKind =
  | 'test'
  | 'list-models'
  | 'continue'
  | 'continue-stream'
  | 'plan-beats'
  | 'image-tags'
  | 'image-generate'

export interface ApiLogEntry {
  id: string
  ts: string
  provider: string
  model: string | null
  kind: ApiLogKind
  url: string
  request_body_preview: string | null
  request_body_size: number
  status: number | null
  response_body_preview: string | null
  response_body_size: number
  error: string | null
  duration_ms: number
  story_id?: string
  chapter_number?: number
  stream_chunks?: number
  /** Full bodies. Persisted to disk, but stripped from list results — populated only
   *  when an entry is fetched individually via getLogEntry (for the detail view). */
  request_body?: string
  response_body?: string
}

function preview(s: string | null | undefined): { preview: string | null; size: number } {
  if (s == null) return { preview: null, size: 0 }
  const size = s.length
  if (size <= PREVIEW_LIMIT) return { preview: s, size }
  return { preview: s.slice(0, PREVIEW_LIMIT) + `…[truncated ${size - PREVIEW_LIMIT} chars]`, size }
}

function logsDir(workspace: string): string {
  return join(workspace, 'logs')
}

const LOG_FILE_RE = /^api-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/

function dateStamp(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

interface LogFile {
  name: string
  path: string
  size: number
  mtimeMs: number
}

async function listLogFiles(dir: string): Promise<LogFile[]> {
  if (!existsSync(dir)) return []
  const names = (await readdir(dir)).filter((n) => LOG_FILE_RE.test(n))
  const out: LogFile[] = []
  for (const name of names) {
    try {
      const s = await stat(join(dir, name))
      out.push({ name, path: join(dir, name), size: s.size, mtimeMs: s.mtimeMs })
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

function segmentOf(name: string): number {
  const m = name.match(/\.(\d+)\.jsonl$/)
  return m ? Number(m[1]) : 0
}

/** Pick the file to append to for today, rolling to a new segment past the size cap. */
async function currentSegmentPath(dir: string): Promise<{ path: string; isNew: boolean }> {
  const base = `api-${dateStamp()}`
  const segRe = new RegExp(`^${base}(?:\\.\\d+)?\\.jsonl$`)
  const files = (await listLogFiles(dir)).filter((f) => segRe.test(f.name))
  if (files.length === 0) return { path: join(dir, `${base}.jsonl`), isNew: true }
  files.sort((a, b) => segmentOf(a.name) - segmentOf(b.name))
  const last = files[files.length - 1]
  if (last.size >= MAX_SEGMENT_BYTES) {
    return { path: join(dir, `${base}.${segmentOf(last.name) + 1}.jsonl`), isNew: true }
  }
  return { path: last.path, isNew: false }
}

/** Delete oldest log files (never the newest) until the directory is under the total cap. */
async function prune(dir: string): Promise<void> {
  const files = await listLogFiles(dir)
  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= MAX_TOTAL_BYTES) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first
  for (let i = 0; i < files.length - 1 && total > MAX_TOTAL_BYTES; i++) {
    try {
      await unlink(files[i].path)
      total -= files[i].size
    } catch {
      /* skip */
    }
  }
}

function broadcast(entry: ApiLogEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('logs:entry-appended', entry)
    }
  }
}

export interface ApiLogInput {
  provider: string
  model: string | null
  kind: ApiLogKind
  url: string
  request_body?: string
  status?: number | null
  response_body?: string
  error?: string | null
  duration_ms: number
  story_id?: string
  chapter_number?: number
  stream_chunks?: number
}

export async function logApiCall(workspace: string, input: ApiLogInput): Promise<ApiLogEntry> {
  const req = preview(input.request_body)
  const res = preview(input.response_body)
  // The light entry (preview only) is what we broadcast/return; the persisted entry also
  // carries the full bodies so the detail view can fetch them on demand.
  const light: ApiLogEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    ts: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    kind: input.kind,
    url: input.url,
    request_body_preview: req.preview,
    request_body_size: req.size,
    status: input.status ?? null,
    response_body_preview: res.preview,
    response_body_size: res.size,
    error: input.error ?? null,
    duration_ms: input.duration_ms,
    ...(input.story_id ? { story_id: input.story_id } : {}),
    ...(input.chapter_number != null ? { chapter_number: input.chapter_number } : {}),
    ...(input.stream_chunks != null ? { stream_chunks: input.stream_chunks } : {})
  }
  const full: ApiLogEntry = {
    ...light,
    ...(input.request_body != null ? { request_body: input.request_body } : {}),
    ...(input.response_body != null ? { response_body: input.response_body } : {})
  }
  try {
    const dir = logsDir(workspace)
    await mkdir(dir, { recursive: true })
    const { path, isNew } = await currentSegmentPath(dir)
    await appendFile(path, JSON.stringify(full) + '\n', 'utf-8')
    if (isNew) await prune(dir)
  } catch {
    // Logging must never throw upward
  }
  broadcast(light)
  return light
}

function stripBodies(entry: ApiLogEntry): ApiLogEntry {
  const copy = { ...entry }
  delete copy.request_body
  delete copy.response_body
  return copy
}

export async function listRecentLogs(workspace: string, limit = 200): Promise<ApiLogEntry[]> {
  const files = await listLogFiles(logsDir(workspace))
  files.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest file first
  const out: ApiLogEntry[] = []
  for (const f of files) {
    if (out.length >= limit) break
    try {
      const text = await readFile(f.path, 'utf-8')
      const lines = text.split('\n').filter((l) => l.length > 0)
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        try {
          out.push(stripBodies(JSON.parse(lines[i]) as ApiLogEntry))
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

/** Fetch a single entry with its full request/response bodies, by id. */
export async function getLogEntry(workspace: string, id: string): Promise<ApiLogEntry | null> {
  const files = await listLogFiles(logsDir(workspace))
  files.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest file first — recent ids likely here
  const needle = `"id":"${id}"`
  for (const f of files) {
    try {
      const text = await readFile(f.path, 'utf-8')
      const lines = text.split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (!line.includes(needle)) continue
        try {
          const entry = JSON.parse(line) as ApiLogEntry
          if (entry.id === id) return entry
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return null
}

export function logsDirPath(workspace: string): string {
  return logsDir(workspace)
}
