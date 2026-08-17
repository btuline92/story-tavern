import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'

/**
 * A lorebook is a SillyTavern-compatible "World Info" collection: named entries whose `content` is
 * injected into the prompt when one of their trigger `key`s appears in the recent manuscript (or
 * always, for `constant` entries). Stored one JSON file per lorebook under `&lt;workspace&gt;/lorebooks/`,
 * selected per story (story.meta.lorebook_ids), mirroring how plugins work.
 *
 * The entry shape follows SillyTavern's standalone World Info field names so import/export round-trips.
 * Fields we don't evaluate (groups, sticky/cooldown, vectorized, triggers, match_*) are preserved
 * verbatim in `extensions` so nothing is lost on re-export.
 */
export interface LorebookEntry {
  uid: number
  key: string[]
  keysecondary: string[]
  comment: string
  content: string
  constant: boolean
  disable: boolean
  selective: boolean
  selectiveLogic: number // 0 AND_ANY, 1 NOT_ALL, 2 NOT_ANY, 3 AND_ALL
  order: number
  position: number // 0 before, 1 after, 4 atDepth (others fall back to "before")
  depth: number
  role: number // 0 system, 1 user, 2 assistant (atDepth only)
  probability: number // 0-100
  useProbability: boolean
  caseSensitive: boolean | null // null = inherit global
  matchWholeWords: boolean | null
  scanDepth: number | null
  excludeRecursion: boolean
  preventRecursion: boolean
  /** Any ST fields we don't model, kept verbatim for lossless export. */
  extensions: Record<string, unknown>
}

export interface Lorebook {
  id: string
  name: string
  description: string
  scan_depth: number | null
  token_budget: number | null
  recursive_scanning: boolean
  entries: LorebookEntry[]
  created_at: string
  updated_at: string
}

// --- coercion helpers (also used by the SillyTavern importers) ---

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const KNOWN_ENTRY_KEYS = new Set([
  'uid',
  'key',
  'keysecondary',
  'comment',
  'content',
  'constant',
  'disable',
  'selective',
  'selectiveLogic',
  'order',
  'position',
  'depth',
  'role',
  'probability',
  'useProbability',
  'caseSensitive',
  'matchWholeWords',
  'scanDepth',
  'excludeRecursion',
  'preventRecursion',
  'extensions'
])

/** Coerce a raw object (our own file, or a SillyTavern standalone WI entry — same field names) into a
 *  fully-defaulted LorebookEntry, stashing any unrecognized keys into `extensions`. */
export function coerceEntry(raw: unknown, fallbackUid: number): LorebookEntry {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const leftover: Record<string, unknown> = {}
  for (const k of Object.keys(r)) if (!KNOWN_ENTRY_KEYS.has(k)) leftover[k] = r[k]
  const priorExt = r.extensions && typeof r.extensions === 'object' ? r.extensions : {}
  return {
    uid: num(r.uid, fallbackUid),
    key: strArr(r.key),
    keysecondary: strArr(r.keysecondary),
    comment: str(r.comment),
    content: str(r.content),
    constant: bool(r.constant),
    disable: bool(r.disable),
    selective: bool(r.selective, true),
    selectiveLogic: num(r.selectiveLogic, 0),
    order: num(r.order, 100),
    position: num(r.position, 0),
    depth: num(r.depth, 4),
    role: num(r.role, 0),
    probability: num(r.probability, 100),
    useProbability: bool(r.useProbability, true),
    caseSensitive: boolOrNull(r.caseSensitive),
    matchWholeWords: boolOrNull(r.matchWholeWords),
    scanDepth: numOrNull(r.scanDepth),
    excludeRecursion: bool(r.excludeRecursion),
    preventRecursion: bool(r.preventRecursion),
    extensions: { ...(priorExt as Record<string, unknown>), ...leftover }
  }
}

export function newEntry(uid: number): LorebookEntry {
  return coerceEntry({}, uid)
}

function normalizeLorebook(raw: unknown, id: string): Lorebook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const now = new Date().toISOString()
  const entries = Array.isArray(r.entries)
    ? r.entries.map((e, i) => coerceEntry(e, i))
    : []
  return {
    id,
    name: str(r.name) || 'Untitled lorebook',
    description: str(r.description),
    scan_depth: numOrNull(r.scan_depth),
    token_budget: numOrNull(r.token_budget),
    recursive_scanning: bool(r.recursive_scanning),
    entries,
    created_at: str(r.created_at) || now,
    updated_at: str(r.updated_at) || now
  }
}

// --- SillyTavern import/export ---

/** Parse a SillyTavern World Info JSON (standalone `{entries:{uid:{…}}}` or a character_book-style
 *  `{entries:[…]}` array) into our entry list. Returns entries + an optional embedded name. */
export function fromSillyTavern(json: unknown): { name: string; entries: LorebookEntry[] } {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const name = str(j.name)
  const raw = j.entries
  if (Array.isArray(raw)) {
    // character_book array form (V2 card): different field names, `enabled` inverted, string positions.
    return { name, entries: raw.map((e, i) => fromCharBookEntry(e, i)) }
  }
  if (raw && typeof raw === 'object') {
    // standalone World Info: uid-keyed object; entry field names match ours.
    return {
      name,
      entries: Object.values(raw as Record<string, unknown>).map((e, i) => coerceEntry(e, i))
    }
  }
  return { name, entries: [] }
}

function fromCharBookEntry(raw: unknown, index: number): LorebookEntry {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ext = (e.extensions && typeof e.extensions === 'object' ? e.extensions : {}) as Record<
    string,
    unknown
  >
  const base = newEntry(num(e.id, index))
  const position =
    typeof ext.position === 'number'
      ? ext.position
      : typeof e.position === 'number'
        ? e.position
        : e.position === 'after_char'
          ? 1
          : 0
  return {
    ...base,
    key: strArr(e.keys),
    keysecondary: strArr(e.secondary_keys),
    comment: str(e.comment) || str(e.name),
    content: str(e.content),
    constant: bool(e.constant),
    disable: !bool(e.enabled, true),
    selective: bool(e.selective, true),
    order: num(e.insertion_order, base.order),
    position,
    depth: num(ext.depth, base.depth),
    role: num(ext.role, base.role),
    probability: num(ext.probability, base.probability),
    useProbability: bool(ext.useProbability, base.useProbability),
    caseSensitive: boolOrNull(e.case_sensitive),
    matchWholeWords: boolOrNull(ext.match_whole_words),
    scanDepth: numOrNull(ext.scan_depth),
    selectiveLogic: num(ext.selectiveLogic, base.selectiveLogic),
    excludeRecursion: bool(ext.exclude_recursion),
    preventRecursion: bool(ext.prevent_recursion),
    extensions: ext
  }
}

/** Serialize back to SillyTavern standalone World Info format (uid-keyed entries object). */
export function toSillyTavern(lb: Lorebook): { entries: Record<string, unknown> } {
  const entries: Record<string, unknown> = {}
  lb.entries.forEach((e, i) => {
    const uid = Number.isFinite(e.uid) ? e.uid : i
    entries[String(uid)] = {
      uid,
      key: e.key,
      keysecondary: e.keysecondary,
      comment: e.comment,
      content: e.content,
      constant: e.constant,
      disable: e.disable,
      selective: e.selective,
      selectiveLogic: e.selectiveLogic,
      order: e.order,
      position: e.position,
      depth: e.depth,
      role: e.role,
      probability: e.probability,
      useProbability: e.useProbability,
      caseSensitive: e.caseSensitive,
      matchWholeWords: e.matchWholeWords,
      scanDepth: e.scanDepth,
      excludeRecursion: e.excludeRecursion,
      preventRecursion: e.preventRecursion,
      ...e.extensions
    }
  })
  return { entries }
}

// --- storage (one JSON file per lorebook) ---

function lorebooksDir(workspace: string): string {
  return join(workspace, 'lorebooks')
}

function lorebookPath(workspace: string, id: string): string {
  return join(lorebooksDir(workspace), `${id}.json`)
}

async function readOne(workspace: string, id: string): Promise<Lorebook | null> {
  const path = lorebookPath(workspace, id)
  if (!existsSync(path)) return null
  try {
    return normalizeLorebook(JSON.parse(await readFile(path, 'utf-8')), id)
  } catch {
    return null
  }
}

async function writeOne(workspace: string, lb: Lorebook): Promise<void> {
  await mkdir(lorebooksDir(workspace), { recursive: true })
  await writeFile(lorebookPath(workspace, lb.id), JSON.stringify(lb, null, 2), 'utf-8')
}

export async function listLorebooks(workspace: string): Promise<Lorebook[]> {
  const dir = lorebooksDir(workspace)
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  const out: Lorebook[] = []
  for (const f of files) {
    const lb = await readOne(workspace, f.replace(/\.json$/, ''))
    if (lb) out.push(lb)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getLorebook(workspace: string, id: string): Promise<Lorebook | null> {
  return readOne(workspace, id)
}

/** Return the given lorebooks in id order (missing ids skipped) — used at generation time. */
export async function getLorebooksByIds(workspace: string, ids: string[]): Promise<Lorebook[]> {
  if (!ids || ids.length === 0) return []
  const out: Lorebook[] = []
  for (const id of ids) {
    const lb = await readOne(workspace, id)
    if (lb) out.push(lb)
  }
  return out
}

export async function createLorebook(workspace: string, name: string): Promise<Lorebook> {
  const now = new Date().toISOString()
  const lb: Lorebook = {
    id: ulid(),
    name: name.trim() || 'Untitled lorebook',
    description: '',
    scan_depth: null,
    token_budget: null,
    recursive_scanning: false,
    entries: [],
    created_at: now,
    updated_at: now
  }
  await writeOne(workspace, lb)
  return lb
}

export async function saveLorebook(workspace: string, lb: Lorebook): Promise<Lorebook> {
  const existing = await readOne(workspace, lb.id)
  const normalized = normalizeLorebook(
    { ...lb, name: lb.name.trim() || 'Untitled lorebook', created_at: existing?.created_at },
    lb.id
  )
  normalized.updated_at = new Date().toISOString()
  await writeOne(workspace, normalized)
  return normalized
}

export async function deleteLorebook(workspace: string, id: string): Promise<void> {
  await rm(lorebookPath(workspace, id)).catch(() => {})
}

/** Import a parsed SillyTavern lorebook JSON as a new lorebook (name falls back to the given default). */
export async function importLorebook(
  workspace: string,
  json: unknown,
  fallbackName: string
): Promise<Lorebook> {
  const { name, entries } = fromSillyTavern(json)
  const lb = await createLorebook(workspace, name || fallbackName)
  lb.entries = entries
  return saveLorebook(workspace, lb)
}
