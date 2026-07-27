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
  /** When set (Magic Complete), the single story beat the model should write as the next
   *  passage. Its ordinal position is carried by beatIndex/beatTotal for pacing awareness. */
  beat?: string
  beatIndex?: number
  beatTotal?: number
  /** Active plugin decorators — extra system-prompt emphasis appended near the end. */
  plugins?: string[]
}

/**
 * Inline image markers are stored in the chapter but must not be fed back to the LLM — otherwise
 * the model imitates the syntax and starts emitting image tags into its prose.
 *
 * The marker is `![alt](url "title")`, where the title is a Danbooru prompt that routinely contains
 * parentheses (e.g. `(from behind)`, `hatsune_miku_(vocaloid)`, `(best quality:1.2)`). Matching the
 * inner part with a naive `[^)]*` stops at the FIRST `)` inside the title and leaves a dangling
 * fragment (`, c")`) behind — which is exactly what leaks into the manuscript. Instead, match the
 * url up to the first whitespace/`)` and the optional quoted title separately (the title is emitted
 * with its own `"` escaped to `'`, so `[^"]*` safely spans any parentheses inside it).
 */
const IMAGE_MARKER_RE = /!\[[^\]]*\]\([^\s)]*(?:\s+"[^"]*")?\)/g
export function stripImageMarkers(content: string): string {
  return content.replace(IMAGE_MARKER_RE, '').replace(/\n{3,}/g, '\n\n')
}

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

/** Magic Complete: direct the model to write exactly one story beat as the next passage. */
function beatGuidance(ctx: AssemblyContext): PromptEntry | null {
  if (!ctx.beat || !ctx.beat.trim()) return null
  const pos =
    ctx.beatIndex != null && ctx.beatTotal != null
      ? ` (beat ${ctx.beatIndex} of ${ctx.beatTotal})`
      : ''
  const isLast = ctx.beatIndex != null && ctx.beatTotal != null && ctx.beatIndex >= ctx.beatTotal
  const tail = isLast
    ? ' This is the final beat of the chapter — bring the chapter to a satisfying close as you write it.'
    : ' Cover this beat fully and let the scene breathe, but do NOT jump ahead into later beats — the beats that follow will be written in their own passages.'
  return {
    role: 'system',
    content:
      `CURRENT BEAT TO WRITE${pos}:\n${ctx.beat.trim()}\n\n` +
      `Write this beat as the next passage of the chapter, picking up in flowing prose exactly where the manuscript leaves off.${tail} ` +
      `Do not output headings, beat labels, lists, or outline text — write prose only.`
  }
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
  // Plugins: reusable system-prompt decorators, appended at the end of the system context for
  // recency emphasis. Interpolated like preset blocks so {{char}} etc. resolve.
  for (const plugin of ctx.plugins ?? []) {
    const content = interpolate(plugin, ctx).trim()
    if (content) entries.push({ role: 'system', content })
  }
  // The current beat directive sits closest to the final nudge for maximum recency.
  const beat = beatGuidance(ctx)
  if (beat) entries.push(beat)
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

/** Merge consecutive same-role messages (any role), joining their content. */
function mergeConsecutiveAny(messages: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else out.push({ ...m })
  }
  return out
}

/**
 * OpenAI-compatible serialization (OpenAI, DeepSeek, and OpenRouter).
 *
 * Consecutive same-role messages are always merged. When `hoistSystem` is set (OpenRouter, which
 * routinely routes to Claude on Vertex), ALL system entries are additionally collapsed into one
 * leading system message with the user/assistant turns after it. Claude via Vertex rejects any
 * inline `system` message that follows an `assistant` turn (or another `system`) — e.g. a plugin
 * or beat directive placed after a preset's assistant "prefill" block. OpenRouter lifts the single
 * leading system into the top-level system param, so no inline system remains — matching how the
 * native Anthropic path (toAnthropic) already serializes. Direct OpenAI/DeepSeek (hoistSystem off)
 * keep inline system messages, which those APIs accept, so their behavior is unchanged.
 */
export function toOpenAI(
  entries: PromptEntry[],
  opts: { hoistSystem?: boolean } = {}
): OpenAIMessage[] {
  if (opts.hoistSystem) {
    const systemText = entries
      .filter((e) => e.role === 'system')
      .map((e) => e.content)
      .join('\n\n')
    let convo = mergeConsecutiveAny(
      entries.filter((e) => e.role !== 'system').map((e) => ({ role: e.role, content: e.content }))
    )
    // The first non-system turn must be a user message for the Anthropic backend.
    if (convo.length === 0 || convo[0].role !== 'user') {
      convo = mergeConsecutiveAny([{ role: 'user', content: 'Continue the story.' }, ...convo])
    }
    return systemText ? [{ role: 'system', content: systemText }, ...convo] : convo
  }
  const messages = mergeConsecutiveAny(entries.map((e) => ({ role: e.role, content: e.content })))
  // Ensure there's at least one user message so the model has a turn to respond to.
  if (!messages.some((m) => m.role === 'user')) {
    messages.push({ role: 'user', content: 'Continue the story.' })
  }
  return messages
}
