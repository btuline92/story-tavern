import type { PromptEntry } from './promptAssembly'
import type { TavernV2Data } from './tavernCard'
import type { ImageSettings } from '../ipc/workspace'
import { readCharacterImageTags } from './characterData'

function cleanTags(s: string): string {
  return s
    .trim()
    .replace(/^,+|,+$/g, '')
    .trim()
}

/** Join comma-separated tag fragments, dropping empties, with a trailing comma. */
export function combineTags(...parts: string[]): string {
  const cleaned = parts.map(cleanTags).filter((p) => p.length > 0)
  if (cleaned.length === 0) return ''
  return cleaned.join(', ') + ','
}

/**
 * Build the system+user messages that turn the latest story passage into a
 * Danbooru tag list. Mirrors the design of the better-st-image plugin.
 */
export function buildTagEntries(opts: {
  image: ImageSettings
  characters: TavernV2Data[]
  passageText: string
}): PromptEntry[] {
  const { image, characters, passageText } = opts
  const parts: string[] = []

  // Character reference comes FIRST — before the task and the story passage — so the model
  // knows what each character looks like before it reads the scene. Appearance/description
  // are the source of truth for physical traits; the passage only supplies pose/action.
  const blocks = characters
    .map((c, i) => {
      const lines: string[] = []
      if (c.name) lines.push(`Name: ${c.name}`)
      const appearance = readCharacterImageTags(c).appearance_tags
      if (appearance) lines.push(`Appearance tags (reproduce these exactly): ${appearance}`)
      if (c.description) lines.push(`Description: ${c.description}`)
      if (c.personality) lines.push(`Personality: ${c.personality}`)
      if (lines.length === 0) return ''
      const label = characters.length > 1 ? `Character ${i + 1}` : 'Character'
      return `${label}:\n${lines.join('\n')}`
    })
    .filter((b) => b.length > 0)

  if (blocks.length > 0) {
    parts.push(
      'CHARACTER REFERENCE — derive each character’s body, skin, hair, and eyes from these ' +
        'details (do NOT invent appearance):\n\n' +
        blocks.join('\n\n')
    )
  }

  parts.push(`TASK: ${image.tagInstruction}`)
  parts.push(`CURRENT SCENE (the most recent passage of the story):\n${passageText.trim()}`)
  parts.push('Respond with ONLY the comma-separated list. Your entire reply must be the list.')

  return [
    { role: 'system', content: image.tagSystemPrompt },
    { role: 'user', content: parts.join('\n\n') }
  ]
}

/** Strip wrapping quotes and "Here are the tags:"-style preambles from the LLM reply. */
export function cleanTagResponse(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(Here|Tags|Output|The tags|Prompt)[^:]*:\s*/i, '')
    .trim()
}

function replaceToken(text: string, name: string, value: unknown): string {
  return text.split(`"%${name}%"`).join(JSON.stringify(value))
}

/**
 * Substitute `%placeholder%` tokens in a ComfyUI workflow JSON string. Values
 * are JSON-encoded so the resulting document is still valid JSON, matching
 * SillyTavern's substitution scheme.
 */
export function substitutePlaceholders(
  workflowJson: string,
  opts: { image: ImageSettings; positive: string; negative: string; seed: number }
): string {
  const { image } = opts
  let wf = workflowJson
  wf = replaceToken(wf, 'prompt', opts.positive)
  wf = replaceToken(wf, 'negative_prompt', opts.negative)
  wf = replaceToken(wf, 'seed', opts.seed)
  wf = replaceToken(wf, 'steps', image.steps)
  wf = replaceToken(wf, 'width', image.width)
  wf = replaceToken(wf, 'height', image.height)
  wf = replaceToken(wf, 'scale', image.cfg)
  wf = replaceToken(wf, 'cfg', image.cfg)
  wf = replaceToken(wf, 'model', image.model)
  wf = replaceToken(wf, 'vae', image.vae)
  wf = replaceToken(wf, 'sampler', image.sampler)
  wf = replaceToken(wf, 'scheduler', image.scheduler)
  wf = replaceToken(wf, 'denoise', image.denoise)
  // ComfyUI expects clip_skip as a negative number.
  wf = replaceToken(wf, 'clip_skip', -Math.abs(image.clipSkip))
  for (const ph of image.customPlaceholders) {
    if (ph.find) wf = replaceToken(wf, ph.find, ph.replace)
  }
  return wf
}
