import { ipcMain } from 'electron'
import { ulid } from 'ulid'
import { getKey } from '../lib/safeStore'
import { readWorkspaceSettings, resolveActiveModel, resolveModelFor } from './workspace'
import { loadStory, updateStoryMeta } from '../lib/storyStorage'
import { getPreset, defaultPreset } from '../lib/presetStore'
import { assemble, stripImageMarkers, type PromptEntry } from '../lib/promptAssembly'
import { streamContinue } from '../lib/streamGeneration'
import { logApiCall } from '../lib/apiLogger'
import { readCharactersData } from '../lib/characterData'
import { getPluginsByIds } from '../lib/pluginStore'
import { getLorebooksByIds } from '../lib/lorebookStore'
import type { TavernV2Data } from '../lib/tavernCard'
import type { StoryWithChapters, Chapter } from '../lib/storyStorage'

const activeStreams = new Map<string, AbortController>()
// A summarization runs before generation and is serialized (one at a time), so a single ref suffices.
let activeSummary: AbortController | null = null

// --- AI character creation ---

export interface GeneratedCharacter {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  tags: string[]
  appearance_tags: string
}

/** Stage 1: freeform character "bible" — lets the model be creative without format pressure. */
function buildBibleEntries(prompt: string): PromptEntry[] {
  return [
    {
      role: 'system',
      content:
        'You are a character designer for interactive fiction. Given a short request, invent a vivid, ' +
        'coherent character. Cover, in flowing prose: name; physical appearance; personality and ' +
        'temperament; background/history; speaking style and mannerisms; and a default scenario the ' +
        'character is in. Be specific and evocative. NSFW is allowed if the request implies it. ' +
        'Write only the character concept — no preamble.'
    },
    { role: 'user', content: `Create a character based on this request:\n\n${prompt.trim()}` }
  ]
}

const CHARACTER_SCHEMA_EXAMPLE = `{
  "name": "Seraphine Vale",
  "description": "A full character sheet: who they are, their history, role, and defining traits, in a few rich paragraphs.",
  "personality": "A concise summary of temperament and behavior — e.g. guarded, dryly witty, fiercely loyal.",
  "scenario": "The default situation the character is in when the story opens.",
  "first_mes": "The character's opening message to {{user}}, in their own voice.",
  "tags": ["female", "elf", "ranger", "grumpy"],
  "appearance_tags": "1girl, silver hair, long hair, green eyes, pointed ears, leather armor, cloak"
}`

/** Stage 2: structure the bible into the exact JSON shape we persist. */
function buildStructureEntries(prompt: string, bible: string): PromptEntry[] {
  return [
    {
      role: 'system',
      content:
        'Convert a character concept into a single JSON object with EXACTLY these keys: ' +
        'name, description, personality, scenario, first_mes, tags, appearance_tags.\n\n' +
        'Rules:\n' +
        '- "description" is the main character sheet (a few paragraphs of prose).\n' +
        '- "personality" and "scenario" are concise.\n' +
        '- "first_mes" is the character\'s opening message; use the {{char}} and {{user}} macros where natural.\n' +
        '- "tags" is a short array of lowercase strings (genre/trait tags). ALWAYS include a gender ' +
        'tag as one of them — "female" or "male" (use "woman"/"man" or another fitting term when more ' +
        'accurate) — so the character can be filtered by gender.\n' +
        '- "appearance_tags" is a comma-separated list of Danbooru/booru visual tags describing ONLY looks ' +
        '(gender count, hair, eyes, body, notable features, clothing) — no personality, no sentences.\n' +
        '- Respond with ONLY the JSON object. No markdown fences, no commentary.\n\n' +
        'Shape (example values):\n' +
        CHARACTER_SCHEMA_EXAMPLE
    },
    {
      role: 'user',
      content: `Original request: ${prompt.trim()}\n\nCharacter concept to structure:\n${bible.trim()}`
    }
  ]
}

/** Repair pass: hand malformed stage-2 output back for correction. */
function buildRepairEntries(bad: string): PromptEntry[] {
  return [
    {
      role: 'system',
      content:
        'The following was supposed to be a single JSON object with keys name, description, personality, ' +
        'scenario, first_mes, tags (array of strings), appearance_tags (string), but it is not valid JSON. ' +
        'Return ONLY the corrected, valid JSON object — same content, fixed syntax. No fences, no commentary.'
    },
    { role: 'user', content: bad }
  ]
}

/** Extract a GeneratedCharacter from the model's JSON reply. Returns null if unusable. */
function parseCharacterJson(text: string): GeneratedCharacter | null {
  const t = (text ?? '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const str = (v: unknown): string =>
    typeof v === 'string'
      ? v.trim()
      : Array.isArray(v)
        ? v
            .map((x) => String(x).trim())
            .filter(Boolean)
            .join(', ')
        : v == null
          ? ''
          : String(v)
  const name = str(o.name)
  if (!name) return null
  const tags = Array.isArray(o.tags)
    ? o.tags.map((x) => String(x).trim()).filter(Boolean)
    : typeof o.tags === 'string'
      ? o.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  return {
    name,
    description: str(o.description),
    personality: str(o.personality),
    scenario: str(o.scenario),
    first_mes: str(o.first_mes),
    tags,
    appearance_tags: str(o.appearance_tags)
  }
}

/** Build the two-message prompt that asks the model to break a chapter outline into ordered beats. */
function buildBeatPlanEntries(args: {
  story: StoryWithChapters
  chapter: Chapter
  outline: string
  characters: TavernV2Data[]
  systemPrompt: string
  plugins: string[]
}): PromptEntry[] {
  const { story, chapter, outline, characters, systemPrompt, plugins } = args
  const charLines = characters
    .map((c) => {
      const name = c.name?.trim() || 'Character'
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim()
      return desc ? `- ${name}: ${desc.slice(0, 400)}` : `- ${name}`
    })
    .join('\n')
  const priorProse = stripImageMarkers(chapter.content).trim()
  const tail = priorProse.slice(-1200)

  // Story style/tone plugins carry the same {{char}}/{{user}} macros as the writing prompt.
  const charNames =
    characters
      .map((c) => c.name?.trim())
      .filter((n): n is string => !!n)
      .join(' and ') || 'the character'
  const pluginText = plugins
    .map((p) => p.replace(/\{\{char\}\}/g, charNames).replace(/\{\{user\}\}/g, 'the protagonist').trim())
    .filter(Boolean)
    .join('\n\n')

  // The system prompt is an editable workspace setting (settings.magicBeatPrompt); default in workspace.ts.
  const system: PromptEntry = { role: 'system', content: systemPrompt }

  const parts: string[] = [`Story title: ${story.meta.title || 'Untitled'}`]
  if (story.meta.premise?.trim()) parts.push(`Premise:\n${story.meta.premise.trim()}`)
  if (charLines) parts.push(`Characters:\n${charLines}`)
  if (pluginText) {
    parts.push(
      "Style & tone guidance for this story — shape the beats' mood, themes, and pacing to match this. " +
        '(The beats themselves stay plain one-sentence descriptions, not prose.)\n' +
        pluginText
    )
  }
  parts.push(`Chapter: ${chapter.title || `Chapter ${chapter.number}`}`)
  parts.push(`Outline to break into beats:\n${outline}`)
  if (tail) {
    parts.push(
      'The chapter already contains prose (truncated tail shown below). Plan beats only for what still ' +
        `needs to happen next; do not repeat what is already written:\n"""\n${tail}\n"""`
    )
  }
  return [system, { role: 'user', content: parts.join('\n\n') }]
}

/** Default number of beats per suggested chapter outline (configurable per request). */
const OUTLINE_BEATS = 8

/** Build the prompt that asks the model for `count` distinct candidate outlines for the next chapter. */
function buildOutlineSuggestEntries(args: {
  story: StoryWithChapters
  chapter: Chapter
  characters: TavernV2Data[]
  guidance: string
  beats: number
  count: number
  plugins: string[]
}): PromptEntry[] {
  const { story, chapter, characters, guidance, beats, count, plugins } = args
  // Story style/tone plugins carry the same {{char}}/{{user}} macros as the writing prompt.
  const charNames =
    characters
      .map((c) => c.name?.trim())
      .filter((n): n is string => !!n)
      .join(' and ') || 'the character'
  const interp = (s: string): string =>
    s.replace(/\{\{char\}\}/g, charNames).replace(/\{\{user\}\}/g, 'the protagonist')
  const pluginText = plugins
    .map((p) => interp(p).trim())
    .filter(Boolean)
    .join('\n\n')
  const charLines = characters
    .map((c) => {
      const name = c.name?.trim() || 'Character'
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim()
      return desc ? `- ${name}: ${desc.slice(0, 300)}` : `- ${name}`
    })
    .join('\n')

  // Prior chapters give continuity: prefer each one's outline, else a truncated prose tail.
  const priorLines: string[] = []
  for (const c of story.chapters) {
    if (c.number >= chapter.number) continue
    const heading = c.title || `Chapter ${c.number}`
    const outline = c.outline.trim()
    if (outline) {
      priorLines.push(`${heading}: ${outline}`)
    } else {
      const prose = stripImageMarkers(c.content).trim()
      if (prose) priorLines.push(`${heading}: …${prose.slice(-500)}`)
    }
  }

  const many = count > 1
  const system: PromptEntry = {
    role: 'system',
    content:
      'You are a story-planning assistant. You propose possible outlines for a chapter of a story.\n\n' +
      `Generate ${count} distinct candidate outline${many ? 's' : ''}. Requirements:\n` +
      `- Each outline is exactly ${beats} story beats, one concise sentence per beat.\n` +
      '- A beat is one step of the chapter — an action, turn, revelation, or emotional shift.\n' +
      '- NSFW Content is allowed.\n' +
      (many
        ? '- The outlines must be meaningfully different from one another: different directions, pacing, ' +
          'or emphasis — not rewordings of the same plot.\n'
        : '') +
      `- Each outline must be consistent with the premise, the characters, and everything in earlier chapters.\n` +
      `- Respond with ONLY a JSON array of ${count} array${many ? 's' : ''}, each inner array containing ` +
      `exactly ${beats} short beat strings. No prose, no keys, no markdown fences. ` +
      'Example: [["…","…"],["…","…"]]'
  }

  const parts: string[] = [`Story title: ${story.meta.title || 'Untitled'}`]
  if (story.meta.premise?.trim()) parts.push(`Premise:\n${story.meta.premise.trim()}`)
  if (charLines) parts.push(`Characters:\n${charLines}`)
  if (priorLines.length) parts.push(`Earlier chapters so far:\n${priorLines.join('\n')}`)
  if (pluginText) {
    parts.push(
      "Style & tone guidance for this story — shape the outlines' mood, themes, and pacing to match " +
        'this. (The beats themselves stay plain one-sentence descriptions, not prose.)\n' +
        pluginText
    )
  }
  parts.push(
    `Propose outlines for: ${chapter.title || `Chapter ${chapter.number}`} (chapter ${chapter.number}).`
  )
  if (chapter.outline.trim()) {
    parts.push(
      `The author's current rough outline draft for this chapter (a starting point, not binding):\n${chapter.outline.trim()}`
    )
  }
  if (guidance.trim()) {
    parts.push(
      `The author's rough idea / guidance — steer all four outlines toward this:\n${guidance.trim()}`
    )
  }
  return [system, { role: 'user', content: parts.join('\n\n') }]
}

/** Parse candidate outlines (each an array of beat strings) from the model's JSON response. */
function parseOutlines(text: string, maxBeats: number, maxOutlines: number): string[][] {
  const t = (text ?? '').trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let data: unknown
  try {
    data = JSON.parse(t.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const outlines: string[][] = []
  for (const item of data) {
    let beats: string[] = []
    if (Array.isArray(item)) {
      beats = item.map((b) => String(b).trim()).filter(Boolean)
    } else if (
      item &&
      typeof item === 'object' &&
      Array.isArray((item as { beats?: unknown }).beats)
    ) {
      beats = (item as { beats: unknown[] }).beats.map((b) => String(b).trim()).filter(Boolean)
    } else if (typeof item === 'string') {
      // A whole outline handed back as one newline-delimited string.
      beats = item
        .split('\n')
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(Boolean)
    }
    if (beats.length) outlines.push(beats.slice(0, maxBeats))
  }
  return outlines.slice(0, maxOutlines)
}

/** Parse the model's beat list — JSON array preferred, numbered/bulleted lines as a fallback. */
function parseBeats(text: string): string[] {
  const t = (text ?? '').trim()
  if (!t) return []
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(t.slice(start, end + 1))
      if (Array.isArray(arr)) {
        const beats = arr.map((x) => String(x).trim()).filter(Boolean)
        if (beats.length) return beats
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  return t
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && !l.startsWith('```'))
}

/** Build the messages that fold the next batch of chapters into the running summary. */
function buildSummarizeEntries(
  systemPrompt: string,
  existingSummary: string,
  batch: Chapter[]
): PromptEntry[] {
  const parts: string[] = []
  parts.push(
    existingSummary.trim()
      ? `EXISTING SYNOPSIS (covers the story up to this point):\n${existingSummary.trim()}`
      : 'There is no existing synopsis yet — this is the start of the story.'
  )
  const chapterBlocks = batch
    .map((c) => `## ${c.title || `Chapter ${c.number}`}\n\n${stripImageMarkers(c.content).trim()}`)
    .join('\n\n')
  parts.push(`NEW CHAPTERS TO FOLD IN:\n\n${chapterBlocks}`)
  const last = batch[batch.length - 1]
  parts.push(
    `Produce the updated synopsis covering the whole story through "${last.title || `Chapter ${last.number}`}". Output only the synopsis.`
  )
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') }
  ]
}

/** Build the prompt for an AI rewrite of a highlighted passage, with full story context. */
/**
 * Build the rewrite prompt on top of the story's ORIGINAL writing system prompt (its persona,
 * character sheets, premise, and style — passed in as `systemEntries`). Rewriting under a bespoke
 * "you are an editor" system prompt made the model drop out of authoring voice and parrot the
 * passage back verbatim; keeping the real system prompt keeps it writing in-voice.
 *
 * The user turn is one message split into three big, unmistakable sections — the story so far, the
 * exact chunk to rewrite, and the author's instruction — so the model never confuses surrounding
 * context with the text it must actually change.
 */
function buildRewriteEntries(args: {
  systemEntries: PromptEntry[]
  story: StoryWithChapters
  chapter: Chapter
  passage: string
  instruction: string
  summaryEnabled: boolean
}): PromptEntry[] {
  const { systemEntries, story, chapter, passage, instruction, summaryEnabled } = args

  const banner = (label: string): string => {
    const bar = '='.repeat(60)
    return `${bar}\n${label}\n${bar}`
  }

  // Respect the summarizer: skip chapters folded into the summary, show the summary instead.
  const through = summaryEnabled ? (story.meta.summary_through_chapter ?? 0) : 0
  const summary = summaryEnabled ? story.meta.summary.trim() : ''
  const priorChapters = story.chapters
    .filter((c) => c.number < chapter.number && c.number > through)
    .sort((a, b) => a.number - b.number)
    .map((c) => `## ${c.title || `Chapter ${c.number}`}\n\n${stripImageMarkers(c.content).trim()}`)
    .filter((b) => b.trim().length > 0)
    .join('\n\n')

  // Lead-in / continuation around the passage within the active chapter.
  const content = chapter.content
  const idx = content.indexOf(passage)
  const leadIn = stripImageMarkers(idx >= 0 ? content.slice(0, idx) : content).trim()
  const after = stripImageMarkers(idx >= 0 ? content.slice(idx + passage.length) : '').trim()

  // Section 1 — the narrative leading up to (and just past) the passage, with a clear placeholder
  // marking exactly where the passage sits in the flow.
  const soFar: string[] = []
  if (summary) soFar.push(`Summary of earlier chapters:\n${summary}`)
  if (priorChapters) soFar.push(priorChapters)
  const cur: string[] = [`## Current chapter — ${chapter.title || `Chapter ${chapter.number}`}`]
  if (leadIn) cur.push(leadIn)
  cur.push('>>>> [ the passage to rewrite is here — its current text is shown below ] <<<<')
  if (after) cur.push(after)
  soFar.push(cur.join('\n\n'))

  const userContent = [
    banner('STORY SO FAR'),
    soFar.join('\n\n'),
    banner('PASSAGE TO REWRITE'),
    passage.trim(),
    banner('REWRITE INSTRUCTIONS'),
    instruction.trim(),
    'Rewrite ONLY the passage shown under "PASSAGE TO REWRITE", applying the instruction above. Keep ' +
      'continuity with the story so far and match its voice, tense, and point of view. NSFW is allowed ' +
      'where the story calls for it. Output ONLY the rewritten passage — no preamble, no surrounding ' +
      'quotation marks, no commentary, no markdown fences.'
  ].join('\n\n')

  return [...systemEntries, { role: 'user', content: userContent }]
}

export function registerGenerationIpc(): void {
  ipcMain.handle(
    'generation:continue-stream',
    async (
      event,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      userNote?: string,
      beat?: string,
      beatIndex?: number,
      beatTotal?: number
    ): Promise<{ streamId: string } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const { provider, model, generation } = resolveActiveModel(settings)
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }

      // Resolve preset: story's preset_id wins, else workspace active preset, else built-in default.
      const presetId = story.meta.preset_id ?? settings.activePresetId
      const preset = (presetId ? await getPreset(workspace, presetId) : null) ?? defaultPreset()

      const characters = await readCharactersData(workspace, story.meta.character_ids)
      const activePlugins = await getPluginsByIds(workspace, story.meta.plugin_ids)
      const activeLorebooks = await getLorebooksByIds(workspace, story.meta.lorebook_ids)

      const entries = assemble(preset, {
        characters,
        storyTitle: story.meta.title,
        storyPremise: story.meta.premise ?? '',
        chapters: story.chapters.map((c) => ({
          number: c.number,
          title: c.title,
          outline: c.outline,
          content: c.content
        })),
        activeChapterNumber: chapterNumber,
        userNote,
        beat,
        beatIndex,
        beatTotal,
        plugins: activePlugins.map((p) => p.content),
        lorebooks: activeLorebooks,
        // Summary context — only when the summarizer is enabled; otherwise send full chapters.
        storySummary: settings.summarizer.enabled ? story.meta.summary : '',
        summarizedThroughChapter: settings.summarizer.enabled
          ? (story.meta.summary_through_chapter ?? 0)
          : 0
      })

      const streamId = ulid()
      const ctrl = new AbortController()
      activeStreams.set(streamId, ctrl)

      const win = event.sender
      const sendDelta = (text: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:delta', streamId, text)
      }
      const sendReasoning = (text: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:reasoning', streamId, text)
      }
      const sendDone = (fullText: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:done', streamId, fullText)
      }
      const sendError = (err: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:error', streamId, err)
      }

      void (async () => {
        const start = Date.now()
        try {
          const metrics = await streamContinue(
            {
              provider,
              model,
              apiKey,
              generation,
              entries,
              openrouter: settings.openrouter
            },
            ctrl.signal,
            { onDelta: sendDelta, onReasoning: sendReasoning, onDone: sendDone, onError: sendError }
          )
          if (ctrl.signal.aborted) sendError('aborted')
          await logApiCall(workspace, {
            provider,
            model,
            kind: 'continue-stream',
            url: metrics.url,
            request_body: metrics.requestBody,
            status: metrics.status,
            response_body: JSON.stringify(
              {
                text: metrics.fullText,
                reasoning: metrics.reasoningText,
                chunk_count: metrics.chunkCount
              },
              null,
              2
            ),
            error: metrics.error,
            duration_ms: metrics.durationMs,
            story_id: storyId,
            chapter_number: chapterNumber,
            stream_chunks: metrics.chunkCount
          })
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          sendError(err)
          await logApiCall(workspace, {
            provider,
            model,
            kind: 'continue-stream',
            url: '',
            status: null,
            error: err,
            duration_ms: Date.now() - start,
            story_id: storyId,
            chapter_number: chapterNumber
          })
        } finally {
          activeStreams.delete(streamId)
        }
      })()

      return { streamId }
    }
  )

  ipcMain.handle(
    'generation:plan-beats',
    async (
      _event,
      workspace: string,
      storyId: string,
      chapterNumber: number
    ): Promise<{ beats: string[] } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const { provider, model, generation } = resolveModelFor(settings, 'beatPlan')
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }
      const chapter = story.chapters.find((c) => c.number === chapterNumber)
      if (!chapter) return { error: `Chapter ${chapterNumber} not found` }
      const outline = chapter.outline.trim()
      if (!outline) {
        return {
          error:
            'This chapter has no outline. Add a chapter outline first — Magic Complete breaks it into beats.'
        }
      }

      const characters = await readCharactersData(workspace, story.meta.character_ids)
      const activePlugins = await getPluginsByIds(workspace, story.meta.plugin_ids)
      const entries = buildBeatPlanEntries({
        story,
        chapter,
        outline,
        characters,
        systemPrompt: settings.magicBeatPrompt,
        plugins: activePlugins.map((p) => p.content)
      })

      const ctrl = new AbortController()
      let planError: string | null = null
      const metrics = await streamContinue(
        {
          provider,
          model,
          apiKey,
          generation,
          entries,
          openrouter: settings.openrouter
        },
        ctrl.signal,
        {
          onDelta: () => {},
          onReasoning: () => {},
          onDone: () => {},
          onError: (e) => {
            planError = e
          }
        }
      )
      await logApiCall(workspace, {
        provider,
        model,
        kind: 'plan-beats',
        url: metrics.url,
        request_body: metrics.requestBody,
        status: metrics.status,
        response_body: JSON.stringify(
          { text: metrics.fullText, reasoning: metrics.reasoningText },
          null,
          2
        ),
        error: metrics.error,
        duration_ms: metrics.durationMs,
        story_id: storyId,
        chapter_number: chapterNumber
      })
      if (planError || metrics.error) {
        return { error: `Beat planning failed: ${planError ?? metrics.error}` }
      }

      const beats = parseBeats(metrics.fullText)
      if (beats.length === 0) return { error: 'The model returned no usable beats.' }
      return { beats }
    }
  )

  ipcMain.handle(
    'generation:suggest-outlines',
    async (
      _event,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      guidance?: string,
      beatCount?: number,
      outlineCount?: number
    ): Promise<{ outlines: string[][] } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const { provider, model, generation } = resolveModelFor(settings, 'outline')
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }
      const chapter = story.chapters.find((c) => c.number === chapterNumber)
      if (!chapter) return { error: `Chapter ${chapterNumber} not found` }

      // Clamp the requested counts to sane ranges; default to OUTLINE_BEATS beats and 4 outlines.
      const beats = Math.min(20, Math.max(1, Math.round(beatCount ?? OUTLINE_BEATS)))
      const count = Math.min(6, Math.max(1, Math.round(outlineCount ?? 4)))
      const characters = await readCharactersData(workspace, story.meta.character_ids)
      const activePlugins = await getPluginsByIds(workspace, story.meta.plugin_ids)
      const entries = buildOutlineSuggestEntries({
        story,
        chapter,
        characters,
        guidance: guidance ?? '',
        beats,
        count,
        plugins: activePlugins.map((p) => p.content)
      })

      const ctrl = new AbortController()
      let genError: string | null = null
      const metrics = await streamContinue(
        {
          provider,
          model,
          apiKey,
          generation,
          entries,
          openrouter: settings.openrouter
        },
        ctrl.signal,
        {
          onDelta: () => {},
          onReasoning: () => {},
          onDone: () => {},
          onError: (e) => {
            genError = e
          }
        }
      )
      await logApiCall(workspace, {
        provider,
        model,
        kind: 'suggest-outlines',
        url: metrics.url,
        request_body: metrics.requestBody,
        status: metrics.status,
        response_body: JSON.stringify(
          { text: metrics.fullText, reasoning: metrics.reasoningText },
          null,
          2
        ),
        error: metrics.error,
        duration_ms: metrics.durationMs,
        story_id: storyId,
        chapter_number: chapterNumber
      })
      if (genError || metrics.error) {
        return { error: `Outline suggestion failed: ${genError ?? metrics.error}` }
      }

      const outlines = parseOutlines(metrics.fullText, beats + 4, count)
      if (outlines.length === 0) return { error: 'The model returned no usable outlines.' }
      return { outlines }
    }
  )

  ipcMain.handle(
    'generation:create-character',
    async (
      _event,
      workspace: string,
      prompt: string
    ): Promise<{ character: GeneratedCharacter } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const { provider, model, generation } = resolveModelFor(settings, 'character')
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }
      if (!prompt || !prompt.trim()) return { error: 'Describe the character you want to create.' }

      // One non-streaming LLM call: collect the full text, log it, return text + error.
      const runCall = async (
        entries: PromptEntry[]
      ): Promise<{ text: string; error: string | null }> => {
        const ctrl = new AbortController()
        let callError: string | null = null
        const metrics = await streamContinue(
          {
            provider,
            model,
            apiKey,
            generation,
            entries,
            openrouter: settings.openrouter
          },
          ctrl.signal,
          {
            onDelta: () => {},
            onReasoning: () => {},
            onDone: () => {},
            onError: (e) => {
              callError = e
            }
          }
        )
        await logApiCall(workspace, {
          provider,
          model,
          kind: 'create-character',
          url: metrics.url,
          request_body: metrics.requestBody,
          status: metrics.status,
          response_body: JSON.stringify(
            { text: metrics.fullText, reasoning: metrics.reasoningText },
            null,
            2
          ),
          error: metrics.error,
          duration_ms: metrics.durationMs
        })
        return { text: metrics.fullText, error: callError ?? metrics.error }
      }

      // Stage 1: freeform character bible.
      const bible = await runCall(buildBibleEntries(prompt))
      if (bible.error) return { error: `Character generation failed: ${bible.error}` }

      // Stage 2: structure it into JSON.
      const structured = await runCall(buildStructureEntries(prompt, bible.text))
      if (structured.error) return { error: `Character generation failed: ${structured.error}` }
      let parsed = parseCharacterJson(structured.text)

      // Repair retry: hand the malformed output back for correction.
      if (!parsed) {
        const repaired = await runCall(buildRepairEntries(structured.text))
        if (!repaired.error) parsed = parseCharacterJson(repaired.text)
      }
      if (!parsed) {
        return { error: 'The model did not return a usable character. Try again or rephrase.' }
      }
      return { character: parsed }
    }
  )

  // Fold the oldest unsummarized chapters into the story's running summary, in batches of M, until the
  // unsummarized count is back within N+M. Steady state = one batch; a far-behind summary (e.g. after a
  // wipe) catches up in one call, one LLM request per batch, persisting each so partial progress sticks.
  // The renderer decides WHEN to call this (when a batch is due), optionally after a confirmation prompt.
  ipcMain.handle(
    'generation:summarize',
    async (
      _event,
      workspace: string,
      storyId: string
    ): Promise<{ summary: string; summary_through_chapter: number } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const sum = settings.summarizer
      if (!sum.enabled) return { error: 'Summarization is disabled in settings.' }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }

      // Model + hyperparameters: the active model preset's summarizer role (falls back to main).
      const { provider, model, generation } = resolveModelFor(settings, 'summarizer')
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const chapters = [...story.chapters].sort((a, b) => a.number - b.number)
      const target = sum.minChapters + sum.batchSize // fold until unsummarized <= N+M
      const ctrl = new AbortController()
      activeSummary = ctrl
      let runningSummary = story.meta.summary
      let through = story.meta.summary_through_chapter ?? 0
      let hardError: string | null = null
      try {
        while (!ctrl.signal.aborted) {
          const unsummarized = chapters.filter((c) => c.number > through)
          if (unsummarized.length <= target) break
          const batch = unsummarized.slice(0, Math.max(1, sum.batchSize))
          const entries = buildSummarizeEntries(sum.prompt, runningSummary, batch)
          let callError: string | null = null
          const metrics = await streamContinue(
            {
              provider,
              model,
              apiKey,
              generation,
              entries,
              disableReasoning: generation.reasoning_level === 'off',
              openrouter: settings.openrouter
            },
            ctrl.signal,
            {
              onDelta: () => {},
              onReasoning: () => {},
              onDone: () => {},
              onError: (e) => {
                callError = e
              }
            }
          )
          await logApiCall(workspace, {
            provider,
            model,
            kind: 'summarize',
            url: metrics.url,
            request_body: metrics.requestBody,
            status: metrics.status,
            response_body: JSON.stringify(
              { text: metrics.fullText, reasoning: metrics.reasoningText },
              null,
              2
            ),
            error: metrics.error,
            duration_ms: metrics.durationMs,
            story_id: storyId
          })
          if (ctrl.signal.aborted) break
          if (callError || metrics.error) {
            hardError = callError ?? metrics.error
            break
          }
          const next = metrics.fullText.trim()
          if (!next) {
            hardError = 'The model returned an empty summary.'
            break
          }
          runningSummary = next
          through = batch[batch.length - 1].number
          // Persist each completed batch so catch-up progress survives a later cancel/error.
          await updateStoryMeta(workspace, storyId, {
            summary: runningSummary,
            summaryThroughChapter: through
          })
        }
      } finally {
        if (activeSummary === ctrl) activeSummary = null
      }

      if (hardError) return { error: `Summarization failed: ${hardError}` }
      if (ctrl.signal.aborted) return { error: 'aborted' }
      return { summary: runningSummary, summary_through_chapter: through }
    }
  )

  // Rewrite a highlighted passage per an instruction, with full story context. One collect call.
  ipcMain.handle(
    'generation:rewrite',
    async (
      _event,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      passage: string,
      instruction: string
    ): Promise<{ text: string } | { error: string }> => {
      if (!passage || !passage.trim()) return { error: 'No passage selected.' }
      if (!instruction || !instruction.trim())
        return { error: 'Enter an instruction for the rewrite.' }

      const settings = await readWorkspaceSettings(workspace)
      const { provider, model, generation } = resolveActiveModel(settings)
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }
      const chapter = story.chapters.find((c) => c.number === chapterNumber)
      if (!chapter) return { error: `Chapter ${chapterNumber} not found` }
      const characters = await readCharactersData(workspace, story.meta.character_ids)

      // Reuse the story's real writing system prompt (same preset assembly as normal generation), so
      // the rewrite runs in-voice. We keep only the SYSTEM entries — persona, character sheets,
      // premise, style, plugins — and supply our own user turn with the passage + instruction.
      const presetId = story.meta.preset_id ?? settings.activePresetId
      const preset = (presetId ? await getPreset(workspace, presetId) : null) ?? defaultPreset()
      const activePlugins = await getPluginsByIds(workspace, story.meta.plugin_ids)
      const activeLorebooks = await getLorebooksByIds(workspace, story.meta.lorebook_ids)
      const assembled = assemble(preset, {
        characters,
        storyTitle: story.meta.title,
        storyPremise: story.meta.premise ?? '',
        chapters: story.chapters.map((c) => ({
          number: c.number,
          title: c.title,
          outline: c.outline,
          content: c.content
        })),
        activeChapterNumber: chapterNumber,
        plugins: activePlugins.map((p) => p.content),
        lorebooks: activeLorebooks,
        storySummary: settings.summarizer.enabled ? story.meta.summary : '',
        summarizedThroughChapter: settings.summarizer.enabled
          ? (story.meta.summary_through_chapter ?? 0)
          : 0
      })
      const systemEntries = assembled.filter((e) => e.role === 'system')

      const entries = buildRewriteEntries({
        systemEntries,
        story,
        chapter,
        passage,
        instruction,
        summaryEnabled: settings.summarizer.enabled
      })

      const ctrl = new AbortController()
      let callError: string | null = null
      const metrics = await streamContinue(
        { provider, model, apiKey, generation, entries, openrouter: settings.openrouter },
        ctrl.signal,
        {
          onDelta: () => {},
          onReasoning: () => {},
          onDone: () => {},
          onError: (e) => {
            callError = e
          }
        }
      )
      await logApiCall(workspace, {
        provider,
        model,
        kind: 'rewrite',
        url: metrics.url,
        request_body: metrics.requestBody,
        status: metrics.status,
        response_body: JSON.stringify(
          { text: metrics.fullText, reasoning: metrics.reasoningText },
          null,
          2
        ),
        error: metrics.error,
        duration_ms: metrics.durationMs,
        story_id: storyId,
        chapter_number: chapterNumber
      })
      if (callError || metrics.error) {
        return { error: `Rewrite failed: ${callError ?? metrics.error}` }
      }
      const text = metrics.fullText.trim()
      if (!text) return { error: 'The model returned an empty rewrite.' }
      return { text }
    }
  )

  ipcMain.handle('generation:cancel-summarize', async (): Promise<boolean> => {
    if (activeSummary) {
      activeSummary.abort()
      activeSummary = null
      return true
    }
    return false
  })

  ipcMain.handle('generation:cancel', async (_e, streamId: string) => {
    const ctrl = activeStreams.get(streamId)
    if (ctrl) {
      ctrl.abort()
      activeStreams.delete(streamId)
      return true
    }
    return false
  })
}
