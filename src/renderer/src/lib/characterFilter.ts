import type { Character } from '../types'

// Gender is not a stored field — it's inferred from a character's free-form tags. Tags are stored
// case-preserving with no normalization, so all matching here case-folds. These sets are the
// recognized gender tags; edit them to broaden the vocabulary.
export const FEMALE_TAGS = new Set([
  'female',
  'woman',
  'women',
  'girl',
  'girls',
  '1girl',
  'lady',
  'gal'
])
export const MALE_TAGS = new Set(['male', 'man', 'men', 'boy', 'boys', '1boy', 'guy', 'gentleman'])

export type GenderFilter = 'all' | 'female' | 'male' | 'untagged'

export interface CharacterFilter {
  search: string
  gender: GenderFilter
  /** Selected tag chips; a character matches if it has ANY of these (case-insensitive). */
  tags: string[]
}

export const EMPTY_FILTER: CharacterFilter = { search: '', gender: 'all', tags: [] }

export function isFilterActive(f: CharacterFilter): boolean {
  return f.search.trim().length > 0 || f.gender !== 'all' || f.tags.length > 0
}

/** True if `tag` is a recognized gender tag (used to keep gender tags out of the generic chip list). */
export function isGenderTag(tag: string): boolean {
  const k = tag.trim().toLowerCase()
  return FEMALE_TAGS.has(k) || MALE_TAGS.has(k)
}

function tagsOf(c: Character): string[] {
  return c.tavern_data?.tags ?? []
}

/**
 * Membership semantics: Female = has any female tag, Male = has any male tag, Untagged = has neither.
 * A character tagged both would match both Female and Male (rare, acceptable).
 */
export function genderMatch(tags: string[], gender: GenderFilter): boolean {
  if (gender === 'all') return true
  const lower = tags.map((t) => t.trim().toLowerCase())
  const hasFemale = lower.some((t) => FEMALE_TAGS.has(t))
  const hasMale = lower.some((t) => MALE_TAGS.has(t))
  if (gender === 'female') return hasFemale
  if (gender === 'male') return hasMale
  return !hasFemale && !hasMale // 'untagged'
}

/** Distinct non-gender tags across all characters, deduped case-insensitively (first-seen casing), sorted. */
export function collectTags(characters: Character[]): string[] {
  const seen = new Map<string, string>()
  for (const c of characters) {
    for (const t of tagsOf(c)) {
      const trimmed = t.trim()
      const k = trimmed.toLowerCase()
      if (!k || isGenderTag(trimmed)) continue
      if (!seen.has(k)) seen.set(k, trimmed)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Apply search (name or any tag), gender, and selected tag chips (ANY). All three AND together. */
export function filterCharacters(characters: Character[], f: CharacterFilter): Character[] {
  const q = f.search.trim().toLowerCase()
  const selected = f.tags.map((t) => t.toLowerCase())
  return characters.filter((c) => {
    const tags = tagsOf(c)
    const lowerTags = tags.map((t) => t.toLowerCase())
    if (!genderMatch(tags, f.gender)) return false
    if (selected.length > 0 && !selected.some((t) => lowerTags.includes(t))) return false
    if (q) {
      const inName = c.name.toLowerCase().includes(q)
      const inTags = lowerTags.some((t) => t.includes(q))
      if (!inName && !inTags) return false
    }
    return true
  })
}
