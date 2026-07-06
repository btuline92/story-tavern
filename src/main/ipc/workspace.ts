import { dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readState, writeState } from '../lib/safeStore'
import { ensureCharactersDirs } from '../lib/characterStorage'
import type { ProviderId } from './providers'
import { defaultModelFor } from './providers'

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

export interface GenerationSettings {
  max_tokens: number
  temperature: number
  top_p: number
  top_k: number | null
  min_p: number | null
  seed: number | null
  stop_sequences: string[]
  frequency_penalty: number
  presence_penalty: number
  /** Unified reasoning/thinking knob across providers. Serializes per-provider at
   *  request time: Anthropic→thinking.budget_tokens, OpenAI o-series→reasoning_effort,
   *  OpenRouter→reasoning.effort. DeepSeek direct ignores it (model-selected). */
  reasoning_level: ReasoningLevel
}

export interface CustomPlaceholder {
  find: string
  replace: string
}

export interface TagModelOverride {
  enabled: boolean
  provider: ProviderId
  model: string
}

export interface TagPrompt {
  name: string
  text: string
}

export interface ImageSettings {
  /** Master switch — when off, no image UI/actions are active. */
  enabled: boolean
  /** Generate an image automatically after each Continue completes. */
  autoAfterContinue: boolean
  comfyUrl: string
  /** Selected workflow filename under workspace/comfy-workflows/. */
  workflow: string
  // ComfyUI placeholder values
  model: string
  vae: string
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  width: number
  height: number
  clipSkip: number
  /** -1 = random each generation. */
  seed: number
  denoise: number
  customPlaceholders: CustomPlaceholder[]
  // Prompt construction
  promptPrefix: string
  negativePrompt: string
  /** Where the tagger's per-character reference comes from. */
  appearanceSource: 'description' | 'appearance'
  // LLM tag generation
  tagSystemPrompt: string
  /** Named "scene instruction" prompts (e.g. camera perspectives); one is active at a time. */
  tagPrompts: TagPrompt[]
  activeTagPrompt: string
  tagTemperature: number
  /** Suppress extended thinking/reasoning for the tagging call (faster). When false,
   *  tagging inherits the workspace generation reasoning_level. */
  tagDisableThinking: boolean
  tagModelOverride: TagModelOverride
}

export interface OpenRouterSettings {
  /** Preferred OpenRouter provider order (provider names, e.g. "OpenAI", "Together").
   *  Empty = let OpenRouter choose. Applies to story generation and image tagging. */
  order: string[]
  /** When false, OpenRouter only uses the providers in `order` and errors if none are
   *  available. When true, it may fall back to other providers. */
  allowFallbacks: boolean
}

export interface WorkspaceSettings {
  selectedProvider: ProviderId
  models: Record<ProviderId, string>
  activePresetId: string | null
  generation: GenerationSettings
  image: ImageSettings
  openrouter: OpenRouterSettings
}

const DEFAULT_GENERATION: GenerationSettings = {
  max_tokens: 4096,
  temperature: 1.0,
  top_p: 1.0,
  top_k: null,
  min_p: null,
  seed: null,
  stop_sequences: [],
  frequency_penalty: 0,
  presence_penalty: 0,
  reasoning_level: 'off'
}

const DEFAULT_TAG_SYSTEM_PROMPT = `You are a Stable Diffusion prompt generator. Your response must contain ONLY a comma-separated list. Do not respond with anything other than the list. NO sentences, NO commentary, NO explanations, NO preamble. Your entire reply is the list and nothing else.

CRITICAL: Output is a comma-separated list. Most items are short tags. EACH CHARACTER, however, is represented as ONE LONG ITEM — a single space-joined phrase with NO INTERNAL COMMAS — describing that character's body, clothing, and unique position in the scene. Do NOT use BREAK. Do NOT put commas inside a character phrase. Quality/style tags (best quality, masterpiece, score_X, etc.) are NOT your job — they are added separately by the prefix. Start your output at the scene tags.

Structure rules:
1. NSFW logic: if the scene is sexual or erotic, the VERY FIRST item is the tag "explicit,". Otherwise begin at step 2.
2. Scene/background tags as short comma-separated items: location, time of day, lighting, atmosphere.
3. Immediately after the scene, include TOTAL gender count tags as separate items: e.g. "2girls, 1boy,". Total across all characters, not per character.
4. For EACH character in the scene, emit ONE comma-separated item that is a single space-joined phrase (no commas inside) describing in order:
   - Role/gender ("girl with", "man with", "futanari with", etc.)
   - Body type and skin tone
   - Hair color and style
   - Eye color
   - Clothing or current state of undress
   - That character's UNIQUE position, action, or interaction in THIS specific moment
   Chain attributes with spaces or the literal word "and" — never commas.
   Example: "girl with slender body dark blue hair ponytail and blue eyes lying on her back and pussy visible"
5. Each character is its own comma-separated item. A two-character scene has two such phrases back to back.
6. After all character phrases, append shared scene tags as normal short items: mutual action, expression, additional foreground/background detail.
7. End the output with a trailing comma.
8. Do NOT include quality/style tags (best quality, masterpiece, score_X, absurdres, aesthetic, etc.). The prefix handles those.
9. Max 40 comma-separated items total.

You MUST output the list directly as your response. Do not think. Do not summarize. Just write the list.

Example output for a two-character explicit bedroom scene:
explicit, apartment bedroom, night, dim streetlight, streetlight through blinds, 1girl, 1boy, girl with slender body dark blue hair ponytail and blue eyes lying on her back and pussy visible, man with toned body fair skin brown hair with penis inside the girl, holding hands, smiling,`

const DEFAULT_TAG_INSTRUCTION = `Convert the current scene from the recent conversation into a Stable Diffusion prompt using the one-phrase-per-character format described in the system prompt.

For each character present, write ONE space-joined phrase (no commas inside) covering, in order: body type, skin tone, hair, eyes, current clothing or undress, and that character's unique position/action in this exact scene moment.

CRITICAL: The body, skin, hair, and eye attributes MUST come directly from the character's card description (or the provided appearance tag list). Do NOT invent traits. If the card says "long red hair, green eyes, freckles" then the phrase says "long red hair and green eyes and freckles". If a comma-separated appearance tag list is provided, transcribe each matching tag into the phrase by replacing commas with spaces or the word "and". Clothing, pose, and action are derived from the recent conversation — body/skin/hair/eyes are faithful to the card.

Order: scene/background tags, total gender count, one space-joined phrase per character, then shared action tags. End with a trailing comma.

Do not use BREAK. Do not put commas inside a character phrase. Do not include quality/style tags — those come from the prefix.`

const MALE_POV_TAG_INSTRUCTION = `Convert the current scene from the recent conversation into a Stable Diffusion prompt showing {{user}}'s first-person point of view. The camera IS {{user}}'s eyes — the image shows what {{user}} sees looking at {{char}}.

Begin with background/location tags (setting, lighting, atmosphere), then the POV tags "pov" and "male pov", then a gender count tag ("1girl," or "1boy," for {{char}}).

For {{char}}, output tags covering:
- Pose and body angle relative to the camera (facing viewer, straddling viewer, cowgirl position, on knees, leaning forward, on top, kneeling, on all fours, etc.)
- Gaze and expression ("looking at viewer", "eye contact", "smiling", "blushing", "open mouth", "tongue out", "half-closed eyes", "shy expression", etc.)
- Current clothing state (clothed sex, topless, nude, clothes lifted, undressed, panties aside, etc.)
- Any body part of {{char}} that is prominent in frame (breasts, hips, thighs, cleavage, etc.)
- Mouth/hand position and physical interaction with {{user}}'s visible body parts (holding {{user}}'s penis, gripping {{user}}'s wrist, hands on {{user}}'s chest, mouth on penis, etc.)
- Character physical traits, must include body type, hair, and eyes from character description

For {{user}}, ONLY include the body parts visible in a first-person shot from his own eyes: hands, forearms, arms, chest if looking down, penis, thighs, feet. Describe what {{user}}'s hands are doing (holding, gripping, touching {{char}}, holding {{char}}'s hair/hips/breasts, spreading, etc.). Do NOT describe {{user}}'s face, hair, or full body — those are outside the field of view.

Extract the literal visual action from the last message. Focus on pose, clothing state, gaze, and physical interaction happening in THIS exact moment as seen by {{user}}.

End with a trailing comma.

CRITICAL:
- Include "pov" and "male pov". This is a first-person shot.
- Do NOT describe {{user}}'s face, hair, or full body — the camera IS his eyes.
- Do NOT include {{char}}'s physical traits (hair color, eye color, body type, skin tone, species). Those come from the character appearance prefix.
- Keep total tags short.
Rules:
1. Include the tags "pov" and "male pov" near the start of the character section.
2. {{char}} (and any other characters present) face the camera or are the primary visual subject. Their pose, expression, clothing state, and action are the focus.
3. Only the parts of {{user}}'s body visible from his own perspective appear in frame — hands, arms, penis, feet if looking down, etc. Do NOT describe {{user}}'s full body or face.
4. Do NOT include physical traits for {{char}} (hair color, eye color, species, body features, etc.). Those are supplied by the character appearance prefix.
5. Extract the literal visual action from the last message. Focus on how {{char}} interacts with {{user}} from {{user}}'s viewpoint.
6. Include a gender count tag (usually 1girl or 1boy for {{char}}).
7. End with a trailing comma.`

const DEFAULT_NEGATIVE_PROMPT =
  'lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry'

const DEFAULT_IMAGE: ImageSettings = {
  enabled: false,
  autoAfterContinue: true,
  comfyUrl: 'http://127.0.0.1:8188',
  workflow: 'Default.json',
  model: '',
  vae: '',
  sampler: 'euler',
  scheduler: 'normal',
  steps: 25,
  cfg: 5,
  width: 1024,
  height: 1024,
  clipSkip: 1,
  seed: -1,
  denoise: 1,
  customPlaceholders: [],
  promptPrefix: 'best quality, absurdres, aesthetic,',
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  appearanceSource: 'description',
  tagSystemPrompt: DEFAULT_TAG_SYSTEM_PROMPT,
  tagPrompts: [
    { name: 'Multi Character 3rd Person', text: DEFAULT_TAG_INSTRUCTION },
    { name: 'Male POV', text: MALE_POV_TAG_INSTRUCTION }
  ],
  activeTagPrompt: 'Multi Character 3rd Person',
  tagTemperature: 0.3,
  tagDisableThinking: true,
  tagModelOverride: { enabled: false, provider: 'anthropic', model: '' }
}

const DEFAULT_OPENROUTER: OpenRouterSettings = {
  order: [],
  allowFallbacks: true
}

function mergeOpenRouter(raw: unknown): OpenRouterSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<OpenRouterSettings>
  return {
    order: Array.isArray(r.order) ? r.order.filter((s): s is string => typeof s === 'string') : [],
    allowFallbacks: typeof r.allowFallbacks === 'boolean' ? r.allowFallbacks : true
  }
}

function mergeImage(raw: unknown): ImageSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImageSettings> & {
    /** Back-compat: superseded by tagPrompts/activeTagPrompt. */
    tagInstruction?: string
  }
  const rawOverride = (r.tagModelOverride ?? {}) as Partial<TagModelOverride>

  // Tag prompts: keep valid entries; otherwise migrate the legacy single tagInstruction.
  let tagPrompts = Array.isArray(r.tagPrompts)
    ? r.tagPrompts.filter(
        (p): p is TagPrompt => !!p && typeof p.name === 'string' && typeof p.text === 'string'
      )
    : []
  if (tagPrompts.length === 0) {
    tagPrompts = [
      {
        name: 'Multi Character 3rd Person',
        text: typeof r.tagInstruction === 'string' ? r.tagInstruction : DEFAULT_TAG_INSTRUCTION
      },
      { name: 'Male POV', text: MALE_POV_TAG_INSTRUCTION }
    ]
  }
  const activeTagPrompt =
    typeof r.activeTagPrompt === 'string' && tagPrompts.some((p) => p.name === r.activeTagPrompt)
      ? r.activeTagPrompt
      : tagPrompts[0].name

  return {
    ...DEFAULT_IMAGE,
    ...r,
    appearanceSource: r.appearanceSource === 'appearance' ? 'appearance' : 'description',
    tagPrompts,
    activeTagPrompt,
    customPlaceholders: Array.isArray(r.customPlaceholders)
      ? r.customPlaceholders.filter(
          (p): p is CustomPlaceholder =>
            !!p && typeof p.find === 'string' && typeof p.replace === 'string'
        )
      : [],
    tagModelOverride: { ...DEFAULT_IMAGE.tagModelOverride, ...rawOverride }
  }
}

function migrateReasoning(raw: unknown): ReasoningLevel {
  const r = (raw && typeof raw === 'object' ? raw : {}) as {
    reasoning_level?: unknown
    reasoning_effort?: unknown
    thinking_enabled?: unknown
  }
  const lvl = r.reasoning_level
  if (lvl === 'off' || lvl === 'low' || lvl === 'medium' || lvl === 'high') return lvl
  // Migrate older settings shape.
  if (r.thinking_enabled === true) return 'medium'
  const eff = r.reasoning_effort
  if (eff === 'low' || eff === 'medium' || eff === 'high') return eff
  if (eff === 'minimal') return 'low'
  return 'off'
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  selectedProvider: 'anthropic',
  models: {
    anthropic: defaultModelFor('anthropic'),
    openai: defaultModelFor('openai'),
    openrouter: defaultModelFor('openrouter'),
    deepseek: defaultModelFor('deepseek')
  },
  activePresetId: null,
  generation: { ...DEFAULT_GENERATION },
  image: { ...DEFAULT_IMAGE },
  openrouter: { ...DEFAULT_OPENROUTER }
}

function mergeSettings(raw: unknown): WorkspaceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorkspaceSettings> & {
    activePromptId?: string | null
  }
  const rawGen = (r.generation ?? {}) as Partial<GenerationSettings>
  const generation: GenerationSettings = {
    ...DEFAULT_GENERATION,
    ...rawGen,
    reasoning_level: migrateReasoning(rawGen)
  }
  return {
    selectedProvider: r.selectedProvider ?? DEFAULT_SETTINGS.selectedProvider,
    models: { ...DEFAULT_SETTINGS.models, ...(r.models ?? {}) },
    // Back-compat: older settings used activePromptId.
    activePresetId: r.activePresetId ?? r.activePromptId ?? null,
    generation,
    image: mergeImage(r.image),
    openrouter: mergeOpenRouter(r.openrouter)
  }
}

async function ensureWorkspaceLayout(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await ensureCharactersDirs(path)
  await mkdir(join(path, 'stories'), { recursive: true })
  const settingsPath = join(path, 'settings.json')
  if (!existsSync(settingsPath)) {
    await writeFile(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8')
  }
}

export async function readWorkspaceSettings(workspace: string): Promise<WorkspaceSettings> {
  const path = join(workspace, 'settings.json')
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } }
  try {
    return mergeSettings(JSON.parse(await readFile(path, 'utf-8')))
  } catch {
    return { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } }
  }
}

async function writeWorkspaceSettings(
  workspace: string,
  settings: WorkspaceSettings
): Promise<void> {
  await writeFile(join(workspace, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:get-last', async () => {
    const state = await readState()
    if (!state.lastWorkspace || !existsSync(state.lastWorkspace)) return null
    return state.lastWorkspace
  })

  ipcMain.handle('workspace:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose your Story Tavern workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    await ensureWorkspaceLayout(path)
    await writeState({ lastWorkspace: path })
    return path
  })

  ipcMain.handle('workspace:ensure', async (_e, path: string) => {
    await ensureWorkspaceLayout(path)
    await writeState({ lastWorkspace: path })
    return true
  })

  ipcMain.handle('workspace:settings:get', async (_e, workspace: string) => {
    return readWorkspaceSettings(workspace)
  })

  ipcMain.handle(
    'workspace:settings:set',
    async (_e, workspace: string, settings: WorkspaceSettings) => {
      await writeWorkspaceSettings(workspace, mergeSettings(settings))
      return true
    }
  )
}
