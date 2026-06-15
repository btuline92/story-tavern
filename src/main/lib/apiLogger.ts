import { BrowserWindow } from 'electron'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PREVIEW_LIMIT = 4000

export type ApiLogKind = 'test' | 'list-models' | 'continue' | 'continue-stream'

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

function todayFilePath(workspace: string): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return join(logsDir(workspace), `api-${yyyy}-${mm}-${dd}.jsonl`)
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
  const entry: ApiLogEntry = {
    id:
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8),
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
  try {
    await mkdir(logsDir(workspace), { recursive: true })
    await appendFile(todayFilePath(workspace), JSON.stringify(entry) + '\n', 'utf-8')
  } catch {
    // Logging must never throw upward
  }
  broadcast(entry)
  return entry
}

export async function listRecentLogs(
  workspace: string,
  limit = 200
): Promise<ApiLogEntry[]> {
  const dir = logsDir(workspace)
  if (!existsSync(dir)) return []
  const files = (await readdir(dir))
    .filter((f) => /^api-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .reverse() // newest day first
  const out: ApiLogEntry[] = []
  for (const f of files) {
    if (out.length >= limit) break
    try {
      const text = await readFile(join(dir, f), 'utf-8')
      const lines = text.split('\n').filter((l) => l.length > 0)
      // Newest entries first (reverse order within file)
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        try {
          out.push(JSON.parse(lines[i]) as ApiLogEntry)
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

export function logsDirPath(workspace: string): string {
  return logsDir(workspace)
}
