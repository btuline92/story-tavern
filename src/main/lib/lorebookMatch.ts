import type { Lorebook, LorebookEntry } from './lorebookStore'

/**
 * SillyTavern-style World Info activation, adapted for a prose tool (no chat messages — we scan the
 * outgoing manuscript text instead). Implements: constant entries, primary/secondary keyword matching
 * with AND/NOT logic, case-sensitivity, whole-word, `/regex/` keys, recursion, probability rolls,
 * `order` sorting, and a char budget. Groups/timed/vectorized/at-depth-scanning are not evaluated.
 */
export interface LorebookGlobals {
  caseSensitive: boolean
  matchWholeWords: boolean
  recursive: boolean
  maxRecursionSteps: number
  /** Rough char cap on total injected lore (~4 chars/token). */
  budgetChars: number
}

export const DEFAULT_LOREBOOK_GLOBALS: LorebookGlobals = {
  caseSensitive: false,
  matchWholeWords: false,
  recursive: true,
  maxRecursionSteps: 3,
  budgetChars: 8000
}

/** Does a single key match the haystack? A `/pattern/flags` key is treated as a regex. */
function keyMatches(rawKey: string, hay: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const key = rawKey.trim()
  if (!key) return false
  const lit = /^\/(.*)\/([a-z]*)$/i.exec(key)
  if (lit) {
    try {
      return new RegExp(lit[1], lit[2]).test(hay)
    } catch {
      return false
    }
  }
  const k = caseSensitive ? key : key.toLowerCase()
  const h = caseSensitive ? hay : hay.toLowerCase()
  // ST does whole-word matching only for single-token keys; multi-word keys use substring.
  if (wholeWords && !/\s/.test(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|\\W)${esc}(?:$|\\W)`).test(h)
  }
  return h.includes(k)
}

function secondaryOk(entry: LorebookEntry, hay: string, cs: boolean, ww: boolean): boolean {
  if (entry.keysecondary.length === 0) return true
  const matches = entry.keysecondary.map((k) => keyMatches(k, hay, cs, ww))
  switch (entry.selectiveLogic) {
    case 1: // NOT_ALL — at least one secondary did NOT match
      return matches.some((m) => !m)
    case 2: // NOT_ANY — no secondary matched
      return !matches.some(Boolean)
    case 3: // AND_ALL — every secondary matched
      return matches.every(Boolean)
    case 0: // AND_ANY — at least one secondary matched
    default:
      return matches.some(Boolean)
  }
}

/**
 * Select the lorebook entries that should be injected for the given scan text.
 * `rng` is injectable so probability is testable (defaults to Math.random).
 */
export function selectEntries(
  lorebooks: Lorebook[],
  scanText: string,
  globals: LorebookGlobals = DEFAULT_LOREBOOK_GLOBALS,
  rng: () => number = Math.random
): LorebookEntry[] {
  const all = lorebooks.flatMap((lb) => lb.entries).filter((e) => !e.disable)
  const cs = (e: LorebookEntry): boolean => e.caseSensitive ?? globals.caseSensitive
  const ww = (e: LorebookEntry): boolean => e.matchWholeWords ?? globals.matchWholeWords
  const rollOk = (e: LorebookEntry): boolean =>
    !e.useProbability || e.probability >= 100 || rng() * 100 <= e.probability

  const activated: LorebookEntry[] = []
  const seen = new Set<LorebookEntry>()

  const pass = (hay: string, isRecursion: boolean): LorebookEntry[] => {
    const newly: LorebookEntry[] = []
    for (const e of all) {
      if (seen.has(e)) continue
      if (isRecursion && e.excludeRecursion) continue
      let matched = false
      if (e.constant) matched = true
      else if (e.key.length > 0) {
        matched =
          e.key.some((k) => keyMatches(k, hay, cs(e), ww(e))) && secondaryOk(e, hay, cs(e), ww(e))
      }
      if (!matched || !rollOk(e)) continue
      seen.add(e)
      activated.push(e)
      newly.push(e)
    }
    return newly
  }

  let haystack = scanText
  let newly = pass(haystack, false)
  if (globals.recursive) {
    let steps = 0
    while (newly.length > 0 && steps < globals.maxRecursionSteps) {
      const addition = newly
        .filter((e) => !e.preventRecursion)
        .map((e) => e.content)
        .join('\n')
      if (!addition.trim()) break
      haystack += '\n' + addition
      newly = pass(haystack, true)
      steps++
    }
  }

  // Higher `order` inserts first; then trim to the char budget (dropping the entry that overflows).
  activated.sort((a, b) => b.order - a.order)
  const out: LorebookEntry[] = []
  let used = 0
  for (const e of activated) {
    used += e.content.length
    if (used > globals.budgetChars) break
    out.push(e)
  }
  return out
}
