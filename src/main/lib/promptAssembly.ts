import type { Preset, MarkerType } from './presetStore'
import type { TavernV2Data } from './tavernCard'

export type EntryRole = 'system' | 'user' | 'assistant'

export interface PromptEntry {
  role: EntryRole
  content: string
}

export interface AssemblyContext {
  characters: TavernV2Data[]
  storyTitle: string
  storyPremise: string
  chapters: Array<{ number: number; title: string; outline: string; content: string }>
  activeChapterNumber: number
  userNote?: string
  /** When set (one-click "write to length"), the model is told the chapter's word target
   *  and nudged to start wrapping up as it approaches it. */
  targetWords?: number
  /** Active plugin decorators — extra system-prompt emphasis appended near the end. */
  plugins?: string[]
}

/** Inline image markers are stored in the chapter but must not be fed back to the LLM. */
const IMAGE_MARKER_RE = /!\[[^\]]*\]\([^)]*\)/g
function stripImageMarkers(content: string): string {
  return content.replace(IMAGE_MARKER_RE, '').replace(/\n{3,}/g, '\n\n')
}
/** Approaching within this many words of the target flips on wrap-up guidance. */
const WRAP_UP_THRESHOLD = 300

function charNames(ctx: AssemblyContext): string {
  const names = ctx.characters.map((c) => c.name).filter((n) => n && n.trim())
  return names.length > 0 ? names.join(' and ') : 'the character'
}

function interpolate(text: string, ctx: AssemblyContext): string {
  // {{scenario}}/{{personality}} are single-value macros; use the first character.
  const first = ctx.characters[0]
  return text
    .replace(/\{\{char\}\}/g, charNames(ctx))
    .replace(/\{\{user\}\}/g, 'the protagonist')
    .replace(/\{\{scenario\}\}/g, first?.scenario ?? '')
    .replace(/\{\{personality\}\}/g, first?.personality ?? '')
}

/** Combine one character field across all characters into a single labeled block. */
function combineCharField(
  ctx: AssemblyContext,
  select: (c: TavernV2Data) => string,
  label: string
): PromptEntry | null {
  const blocks = ctx.characters
    .map((c) => ({ name: c.name, value: select(c) }))
    .filter((b) => b.value && b.value.trim())
  if (blocks.length === 0) return null
  if (blocks.length === 1) {
    return { role: 'system', content: `${label}:\n${blocks[0].value}` }
  }
  const body = blocks.map((b) => `## ${b.name || 'Character'}\n${b.value}`).join('\n\n')
  return { role: 'system', content: `${label}:\n${body}` }
}

function manuscriptText(ctx: AssemblyContext): string {
  const lines: string[] = []
  for (const ch of ctx.chapters) {
    if (ch.number > ctx.activeChapterNumber) continue
    const heading = ch.title || `Chapter ${ch.number}`
    // For the active chapter only, prepend the outline so the model knows what
    // should happen in the passage it's about to continue. Earlier chapters'
    // outlines are skipped — their prose embodies them.
    const body = stripImageMarkers(ch.content)
    if (ch.number === ctx.activeChapterNumber && ch.outline.trim()) {
      lines.push(`## ${heading}\n[Outline for this chapter: ${ch.outline.trim()}]\n\n${body}`)
    } else {
      lines.push(`## ${heading}\n\n${body}`)
    }
  }
  return lines.join('\n\n').trim()
}

function activeChapterWordCount(ctx: AssemblyContext): number {
  const ch = ctx.chapters.find((c) => c.number === ctx.activeChapterNumber)
  if (!ch) return 0
  return (stripImageMarkers(ch.content).trim().match(/\S+/g) ?? []).length
}

/** Tell the model the chapter's word target and, near the end, to start wrapping up. */
function lengthGuidance(ctx: AssemblyContext): PromptEntry | null {
  if (!ctx.targetWords || ctx.targetWords <= 0) return null
  const target = ctx.targetWords
  const current = activeChapterWordCount(ctx)
  const remaining = target - current
  let content: string
  if (remaining <= 0) {
    content = `LENGTH TARGET: this chapter has reached its target of about ${target} words (currently about ${current}). Bring the current scene to a satisfying close in this passage — resolve the immediate moment rather than opening new threads.`
  } else if (remaining <= WRAP_UP_THRESHOLD) {
    content = `LENGTH TARGET: this chapter is nearing its target of about ${target} words (currently about ${current}, ~${remaining} to go). Begin steering the scene toward a natural stopping point over this and perhaps one more passage — start wrapping up rather than introducing new threads.`
  } else {
    content = `LENGTH TARGET: this chapter is being written toward about ${target} words (currently about ${current}). Keep the scene developing at a natural pace; do not rush toward a conclusion yet.`
  }
  return { role: 'system', content }
}

function upcomingOutlinesText(ctx: AssemblyContext): string {
  const lines: string[] = []
  for (const ch of ctx.chapters) {
    if (ch.number <= ctx.activeChapterNumber) continue
    if (!ch.outline.trim()) continue
    const heading = ch.title || `Chapter ${ch.number}`
    lines.push(`## ${heading}\nOutline: ${ch.outline.trim()}`)
  }
  return lines.join('\n\n')
}

// Markers carry a fixed role intrinsic to their meaning.
function expandMarker(markerType: MarkerType, ctx: AssemblyContext): PromptEntry | null {
  switch (markerType) {
    case 'char_description':
      return combineCharField(ctx, (c) => c.description, 'Character description')
    case 'char_personality':
      return combineCharField(ctx, (c) => c.personality, 'Character personality')
    case 'scenario':
      return combineCharField(ctx, (c) => c.scenario, 'Scenario')
    case 'dialogue_examples':
      return combineCharField(ctx, (c) => c.mes_example, 'Dialogue examples')
    case 'story_premise':
      return ctx.storyPremise.trim()
        ? { role: 'system', content: `Story premise:\n${ctx.storyPremise.trim()}` }
        : null
    case 'manuscript': {
      const ms = manuscriptText(ctx)
      return ms
        ? { role: 'user', content: `--- MANUSCRIPT ---\n${ms}\n--- END MANUSCRIPT ---` }
        : null
    }
    case 'unsupported':
    default:
      return null
  }
}

function continueNudge(ctx: AssemblyContext): PromptEntry {
  const empty = manuscriptText(ctx).length === 0
  const note = ctx.userNote?.trim() ? `\n\nAuthor note: ${ctx.userNote.trim()}` : ''
  const content = empty
    ? `Begin writing the story titled "${ctx.storyTitle}". Open in flowing prose.${note}`
    : `Continue the story from exactly where the manuscript leaves off. Match the voice, tense, and point of view. Do not repeat or summarize existing text.${note}`
  return { role: 'user', content }
}

/** Walk a preset's enabled blocks in order, expanding markers, producing a flat entry list. */
export function assemble(preset: Preset, ctx: AssemblyContext): PromptEntry[] {
  const entries: PromptEntry[] = []
  let manuscriptSeen = false
  for (const block of preset.blocks) {
    if (!block.enabled) continue
    if (block.marker) {
      if (block.markerType === 'manuscript') manuscriptSeen = true
      const entry = block.markerType ? expandMarker(block.markerType, ctx) : null
      if (entry) entries.push(entry)
    } else {
      const content = interpolate(block.content, ctx).trim()
      if (content) entries.push({ role: block.role, content })
    }
  }
  // If the preset has no manuscript marker, the model still needs the prose to continue.
  if (!manuscriptSeen) {
    const ms = manuscriptText(ctx)
    if (ms)
      entries.push({ role: 'user', content: `--- MANUSCRIPT ---\n${ms}\n--- END MANUSCRIPT ---` })
  }
  // Append outlines for chapters the author has planned but not yet written. Tells the
  // model where the story is heading so it can foreshadow / pace appropriately.
  const upcoming = upcomingOutlinesText(ctx)
  if (upcoming) {
    entries.push({
      role: 'system',
      content:
        '=== Upcoming chapters (outline only — not yet written) ===\n' +
        upcoming +
        '\n\nUse these as direction for where the story is heading. Do not reach the material from those chapters yet — the current passage you are writing is the active chapter only.'
    })
  }
  const guidance = lengthGuidance(ctx)
  if (guidance) entries.push(guidance)
  // Plugins: reusable system-prompt decorators, appended at the end of the system context for
  // recency emphasis. Interpolated like preset blocks so {{char}} etc. resolve.
  for (const plugin of ctx.plugins ?? []) {
    const content = interpolate(plugin, ctx).trim()
    if (content) entries.push({ role: 'system', content })
  }
  entries.push(continueNudge(ctx))
  return entries
}

// --- Per-provider serialization ---

function mergeConsecutive(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Array<{
  role: 'user' | 'assistant'
  content: string
}> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else out.push({ ...m })
  }
  return out
}

export interface AnthropicShape {
  system: Array<{ type: 'text'; text: string }>
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Anthropic: system role is a top-level array; messages may only be user/assistant. */
export function toAnthropic(entries: PromptEntry[]): AnthropicShape {
  const system: Array<{ type: 'text'; text: string }> = []
  const rawMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const e of entries) {
    if (e.role === 'system') system.push({ type: 'text', text: e.content })
    else rawMessages.push({ role: e.role, content: e.content })
  }
  let messages = mergeConsecutive(rawMessages)
  // Anthropic requires the first message to be a user turn.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages = [{ role: 'user', content: 'Continue the story.' }, ...messages]
    messages = mergeConsecutive(messages)
  }
  return { system, messages }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** OpenAI-compatible: system messages can appear inline; pass entries through. */
export function toOpenAI(entries: PromptEntry[]): OpenAIMessage[] {
  const messages = entries.map((e) => ({ role: e.role, content: e.content }))
  // Ensure there's at least one user message so the model has a turn to respond to.
  if (!messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user', content: 'Continue the story.' })
  }
  return messages
}
