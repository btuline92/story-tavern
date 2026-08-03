import { ipcMain } from 'electron'
import { ulid } from 'ulid'
import { getKey } from '../lib/safeStore'
import { readWorkspaceSettings } from './workspace'
import { loadStory } from '../lib/storyStorage'
import { getPreset, defaultPreset } from '../lib/presetStore'
import { assemble, stripImageMarkers, type PromptEntry } from '../lib/promptAssembly'
import { streamContinue } from '../lib/streamGeneration'
import { logApiCall } from '../lib/apiLogger'
import { readCharactersData } from '../lib/characterData'
import { getPluginsByIds } from '../lib/pluginStore'
import type { TavernV2Data } from '../lib/tavernCard'
import type { StoryWithChapters, Chapter } from '../lib/storyStorage'
import type { ProviderId } from './providers'

const activeStreams = new Map<string, AbortController>()

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
  "tags": ["elf", "ranger", "grumpy"],
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
        '- "tags" is a short array of lowercase strings (genre/trait tags).\n' +
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
}): PromptEntry[] {
  const { story, chapter, outline, characters } = args
  const charLines = characters
    .map((c) => {
      const name = c.name?.trim() || 'Character'
      const desc = (c.description ?? '').replace(/\s+/g, ' ').trim()
      return desc ? `- ${name}: ${desc.slice(0, 400)}` : `- ${name}`
    })
    .join('\n')
  const priorProse = stripImageMarkers(chapter.content).trim()
  const tail = priorProse.slice(-1200)

  const system: PromptEntry = {
    role: 'system',
    content:
      'You are a story-planning assistant. You break a chapter outline into an ordered list of concrete story beats.\n' +
      'A beat is a single step of the chapter — one action, turn, revelation, or emotional shift — that would be written as roughly a few paragraphs of prose.\n\n' +
      'Rules:\n' +
      '- Order the beats as they occur in the chapter.\n' +
      '- Together the beats must cover the entire outline. Do not invent a different plot; you may add small connective moments.\n' +
      '- Each beat is one or two sentences of plain description of what happens, not prose.\n' +
      '- Prefer 4–8 beats for a normal outline; use fewer for a thin outline, more for a dense one.\n' +
      '- Respond with ONLY a JSON array of strings and nothing else — no prose, no keys, no markdown fences. ' +
      '- NSFW content is allowed if the outline calls for it. \n' +
      'Example: ["Beat one...", "Beat two...", "Beat three..."]'
  }

  const parts: string[] = [`Story title: ${story.meta.title || 'Untitled'}`]
  if (story.meta.premise?.trim()) parts.push(`Premise:\n${story.meta.premise.trim()}`)
  if (charLines) parts.push(`Characters:\n${charLines}`)
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

/** Build the prompt that asks the model for four distinct candidate outlines for the next chapter. */
function buildOutlineSuggestEntries(args: {
  story: StoryWithChapters
  chapter: Chapter
  characters: TavernV2Data[]
  guidance: string
  beats: number
}): PromptEntry[] {
  const { story, chapter, characters, guidance, beats } = args
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

  const system: PromptEntry = {
    role: 'system',
    content:
      'You are a story-planning assistant. You propose possible outlines for a chapter of a story.\n\n' +
      'Generate FOUR distinct candidate outlines. Requirements:\n' +
      `- Each outline is exactly ${beats} story beats, one concise sentence per beat.\n` +
      '- A beat is one step of the chapter — an action, turn, revelation, or emotional shift.\n' +
      '- NSFW Content is allowed.\n' +
      '- The four outlines must be meaningfully different from one another: different directions, pacing, ' +
      'or emphasis — not four rewordings of the same plot.\n' +
      '- All four must be consistent with the premise, the characters, and everything in earlier chapters.\n' +
      `- Respond with ONLY a JSON array of 4 arrays, each inner array containing exactly ${beats} short ` +
      'beat strings. No prose, no keys, no markdown fences. ' +
      'Example: [["…","…"],["…","…"],["…","…"],["…","…"]]'
  }

  const parts: string[] = [`Story title: ${story.meta.title || 'Untitled'}`]
  if (story.meta.premise?.trim()) parts.push(`Premise:\n${story.meta.premise.trim()}`)
  if (charLines) parts.push(`Characters:\n${charLines}`)
  if (priorLines.length) parts.push(`Earlier chapters so far:\n${priorLines.join('\n')}`)
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

/** Parse four candidate outlines (each an array of beat strings) from the model's JSON response. */
function parseOutlines(text: string, maxBeats: number): string[][] {
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
  return outlines.slice(0, 4)
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
      const provider: ProviderId = settings.selectedProvider
      const model = settings.models[provider]
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }

      // Resolve preset: story's preset_id wins, else workspace active preset, else built-in default.
      const presetId = story.meta.preset_id ?? settings.activePresetId
      const preset = (presetId ? await getPreset(workspace, presetId) : null) ?? defaultPreset()

      const characters = await readCharactersData(workspace, story.meta.character_ids)
      const activePlugins = await getPluginsByIds(workspace, story.meta.plugin_ids)

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
        plugins: activePlugins.map((p) => p.content)
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
              generation: settings.generation,
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
      const provider: ProviderId = settings.selectedProvider
      const model = settings.models[provider]
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
      const entries = buildBeatPlanEntries({ story, chapter, outline, characters })

      const ctrl = new AbortController()
      let planError: string | null = null
      const metrics = await streamContinue(
        {
          provider,
          model,
          apiKey,
          generation: settings.generation,
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
      beatCount?: number
    ): Promise<{ outlines: string[][] } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const provider: ProviderId = settings.selectedProvider
      const model = settings.models[provider]
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }
      const chapter = story.chapters.find((c) => c.number === chapterNumber)
      if (!chapter) return { error: `Chapter ${chapterNumber} not found` }

      // Clamp the requested beat count to a sane range; default to OUTLINE_BEATS.
      const beats = Math.min(20, Math.max(1, Math.round(beatCount ?? OUTLINE_BEATS)))
      const characters = await readCharactersData(workspace, story.meta.character_ids)
      const entries = buildOutlineSuggestEntries({
        story,
        chapter,
        characters,
        guidance: guidance ?? '',
        beats
      })

      const ctrl = new AbortController()
      let genError: string | null = null
      const metrics = await streamContinue(
        {
          provider,
          model,
          apiKey,
          generation: settings.generation,
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

      const outlines = parseOutlines(metrics.fullText, beats + 4)
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
      const provider: ProviderId = settings.selectedProvider
      const model = settings.models[provider]
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
            generation: settings.generation,
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
