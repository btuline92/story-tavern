import type { StoryMeta } from '../types'

export interface StoryFilter {
  search: string
  /** Selected tag chips; a story matches if it has ANY of these (case-insensitive). */
  tags: string[]
}

export const EMPTY_STORY_FILTER: StoryFilter = { search: '', tags: [] }

export function isStoryFilterActive(f: StoryFilter): boolean {
  return f.search.trim().length > 0 || f.tags.length > 0
}

/** Distinct story tags across all stories, deduped case-insensitively (first-seen casing), sorted. */
export function collectStoryTags(stories: StoryMeta[]): string[] {
  const seen = new Map<string, string>()
  for (const s of stories) {
    for (const t of s.tags ?? []) {
      const trimmed = t.trim()
      const k = trimmed.toLowerCase()
      if (!k) continue
      if (!seen.has(k)) seen.set(k, trimmed)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Filter stories by search (name or any tag substring) AND selected chips (any-of). */
export function filterStories(stories: StoryMeta[], f: StoryFilter): StoryMeta[] {
  const q = f.search.trim().toLowerCase()
  const selected = f.tags.map((t) => t.toLowerCase())
  return stories.filter((s) => {
    const lowerTags = (s.tags ?? []).map((t) => t.toLowerCase())
    if (selected.length > 0 && !selected.some((t) => lowerTags.includes(t))) return false
    if (q) {
      const inName = (s.title || s.slug).toLowerCase().includes(q)
      const inTags = lowerTags.some((t) => t.includes(q))
      if (!inName && !inTags) return false
    }
    return true
  })
}
