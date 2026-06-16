import type { Preset, MarkerType } from './presetStore'
import type { TavernV2Data } from './tavernCard'

export type EntryRole = 'system' | 'user' | 'assistant'

export interface PromptEntry {
  role: EntryRole
  content: string
}

export interface AssemblyContext {
  character: TavernV2Data | null
  storyTitle: string
  storyPremise: string
  chapters: Array<{ number: number; title: string; outline: string; content: string }>
  activeChapterNumber: number
  userNote?: string
}

function interpolate(text: string, ctx: AssemblyContext): string {
  const charName = ctx.character?.name || 'the character'
  return text
    .replace(/\{\{char\}\}/g, charName)
    .replace(/\{\{user\}\}/g, 'the protagonist')
    .replace(/\{\{scenario\}\}/g, ctx.character?.scenario ?? '')
    .replace(/\{\{personality\}\}/g, ctx.character?.personality ?? '')
}

function manuscriptText(ctx: AssemblyContext): string {
  const lines: string[] = []
  for (const ch of ctx.chapters) {
    if (ch.number > ctx.activeChapterNumber) continue
    const heading = ch.title || `Chapter ${ch.number}`
    // For the active chapter only, prepend the outline so the model knows what
    // should happen in the passage it's about to continue. Earlier chapters'
    // outlines are skipped — their prose embodies them.
    if (ch.number === ctx.activeChapterNumber && ch.outline.trim()) {
      lines.push(`## ${heading}\n[Outline for this chapter: ${ch.outline.trim()}]\n\n${ch.content}`)
    } else {
      lines.push(`## ${heading}\n\n${ch.content}`)
    }
  }
  return lines.join('\n\n').trim()
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
      return ctx.character?.description
        ? { role: 'system', content: `Character description:\n${ctx.character.description}` }
        : null
    case 'char_personality':
      return ctx.character?.personality
        ? { role: 'system', content: `Character personality:\n${ctx.character.personality}` }
        : null
    case 'scenario':
      return ctx.character?.scenario
        ? { role: 'system', content: `Scenario:\n${ctx.character.scenario}` }
        : null
    case 'dialogue_examples':
      return ctx.character?.mes_example
        ? { role: 'system', content: `Dialogue examples:\n${ctx.character.mes_example}` }
        : null
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
