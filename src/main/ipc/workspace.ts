import { ipcMain } from 'electron'
import { showOpenDialog } from '../lib/dialogs'
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

/** A named positive+negative prompt-prefix pair, for switching between "classes" of
 *  image generators (e.g. anime vs. realism). One pair is active at a time. */
export interface PromptPrefix {
  name: string
  positive: string
  negative: string
}

/** A named tag-generation system prompt; one is active at a time. */
export interface SystemPrompt {
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
  // Prompt construction — named positive/negative prefix pairs; one active at a time.
  promptPrefixes: PromptPrefix[]
  activePromptPrefix: string
  /** Where the tagger's per-character reference comes from. */
  appearanceSource: 'description' | 'appearance'
  // LLM tag generation
  /** Named system prompts for the tagging LLM; one is active at a time. */
  systemPrompts: SystemPrompt[]
  activeSystemPrompt: string
  /** Named "scene instruction" prompts (e.g. camera perspectives); one is active at a time. */
  tagPrompts: TagPrompt[]
  activeTagPrompt: string
  /** Dedicated generation settings for the tagging LLM call — full hyperparameters +
   *  reasoning. Image tagging no longer inherits the base model's generation settings. */
  generation: GenerationSettings
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

/** A named model configuration — provider, model id, and its own generation settings. The active
 *  one drives all story/character generation and the image-tagging base model. */
export interface ModelPreset {
  id: string
  name: string
  provider: ProviderId
  model: string
  generation: GenerationSettings
}

/** Rolling-summary settings. When enabled, the oldest unsummarized chapters are folded into a running
 *  summary and dropped from context, keeping recent chapters verbatim. */
export interface SummarizerSettings {
  enabled: boolean
  /** N — minimum recent (unsummarized) chapters to keep in context. */
  minChapters: number
  /** M — chapters folded into the summary per run (the oldest unsummarized ones). */
  batchSize: number
  /** Ask for confirmation before running a (potentially slow) summarization. */
  confirmBeforeSummarizing: boolean
  /** Editable instruction telling the model how to summarize. */
  prompt: string
  /** Dedicated generation settings for the summarizer call. */
  generation: GenerationSettings
  /** Optional cheaper/faster model just for summarization; falls back to the active preset. */
  modelOverride: TagModelOverride
}

export interface WorkspaceSettings {
  selectedProvider: ProviderId
  models: Record<ProviderId, string>
  activePresetId: string | null
  generation: GenerationSettings
  image: ImageSettings
  summarizer: SummarizerSettings
  openrouter: OpenRouterSettings
  /** Named model configs; `activeModelPresetId` selects the one used for generation. */
  modelPresets: ModelPreset[]
  activeModelPresetId: string | null
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
  promptPrefixes: [
    {
      name: 'Default',
      positive: 'best quality, absurdres, aesthetic,',
      negative: DEFAULT_NEGATIVE_PROMPT
    }
  ],
  activePromptPrefix: 'Default',
  appearanceSource: 'description',
  systemPrompts: [{ name: 'Default', text: DEFAULT_TAG_SYSTEM_PROMPT }],
  activeSystemPrompt: 'Default',
  tagPrompts: [
    { name: 'Multi Character 3rd Person', text: DEFAULT_TAG_INSTRUCTION },
    { name: 'Male POV', text: MALE_POV_TAG_INSTRUCTION }
  ],
  activeTagPrompt: 'Multi Character 3rd Person',
  // Fast-tagging defaults: low temperature, no extended thinking.
  generation: { ...DEFAULT_GENERATION, temperature: 0.3, reasoning_level: 'off' },
  tagModelOverride: { enabled: false, provider: 'anthropic', model: '' }
}

const DEFAULT_SUMMARIZER_PROMPT = `You maintain a running synopsis of a novel so it can be written without re-reading every chapter.

Given the existing synopsis (if any) and the next chapters, output a single UPDATED synopsis that covers the whole story so far through the last chapter provided. Requirements:
- Capture all important plot events, decisions, and turning points in order.
- Track each character's arc, relationships, knowledge, and current state.
- Preserve continuity a writer needs to stay consistent: locations, timeline, ongoing conflicts, unresolved threads, secrets/promises, and who knows what.
- Be concise but complete — prefer specifics over vague gestures. Past tense, third person, prose (not bullet lists).
- NSFW content is allowed if the story contains it.

Output ONLY the updated synopsis. No preamble, no headings, no commentary.`

const DEFAULT_SUMMARIZER: SummarizerSettings = {
  enabled: false,
  minChapters: 4,
  batchSize: 4,
  confirmBeforeSummarizing: true,
  prompt: DEFAULT_SUMMARIZER_PROMPT,
  // Low temperature, no extended thinking — summaries should be faithful, not creative.
  generation: { ...DEFAULT_GENERATION, temperature: 0.3, reasoning_level: 'off' },
  modelOverride: { enabled: false, provider: 'anthropic', model: '' }
}

function mergeSummarizer(raw: unknown): SummarizerSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SummarizerSettings>
  const rawOverride = (r.modelOverride ?? {}) as Partial<TagModelOverride>
  const rawGen = (r.generation ?? {}) as Partial<GenerationSettings>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SUMMARIZER.enabled,
    minChapters:
      typeof r.minChapters === 'number' && r.minChapters >= 1
        ? Math.floor(r.minChapters)
        : DEFAULT_SUMMARIZER.minChapters,
    batchSize:
      typeof r.batchSize === 'number' && r.batchSize >= 1
        ? Math.floor(r.batchSize)
        : DEFAULT_SUMMARIZER.batchSize,
    confirmBeforeSummarizing:
      typeof r.confirmBeforeSummarizing === 'boolean'
        ? r.confirmBeforeSummarizing
        : DEFAULT_SUMMARIZER.confirmBeforeSummarizing,
    prompt: typeof r.prompt === 'string' ? r.prompt : DEFAULT_SUMMARIZER.prompt,
    generation: { ...DEFAULT_SUMMARIZER.generation, ...rawGen, reasoning_level: migrateReasoning(rawGen) },
    modelOverride: { ...DEFAULT_SUMMARIZER.modelOverride, ...rawOverride }
  }
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
    /** Back-compat legacy fields, superseded by the list/generation fields. */
    tagInstruction?: string
    promptPrefix?: string
    negativePrompt?: string
    tagSystemPrompt?: string
    tagTemperature?: number
    tagDisableThinking?: boolean
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

  // Prompt-prefix pairs: keep valid entries; otherwise migrate legacy promptPrefix/negativePrompt.
  let promptPrefixes = Array.isArray(r.promptPrefixes)
    ? r.promptPrefixes.filter(
        (p): p is PromptPrefix =>
          !!p &&
          typeof p.name === 'string' &&
          typeof p.positive === 'string' &&
          typeof p.negative === 'string'
      )
    : []
  if (promptPrefixes.length === 0) {
    promptPrefixes = [
      {
        name: 'Default',
        positive:
          typeof r.promptPrefix === 'string'
            ? r.promptPrefix
            : DEFAULT_IMAGE.promptPrefixes[0].positive,
        negative: typeof r.negativePrompt === 'string' ? r.negativePrompt : DEFAULT_NEGATIVE_PROMPT
      }
    ]
  }
  const activePromptPrefix =
    typeof r.activePromptPrefix === 'string' &&
    promptPrefixes.some((p) => p.name === r.activePromptPrefix)
      ? r.activePromptPrefix
      : promptPrefixes[0].name

  // System prompts: keep valid entries; otherwise migrate the legacy single tagSystemPrompt.
  let systemPrompts = Array.isArray(r.systemPrompts)
    ? r.systemPrompts.filter(
        (p): p is SystemPrompt => !!p && typeof p.name === 'string' && typeof p.text === 'string'
      )
    : []
  if (systemPrompts.length === 0) {
    systemPrompts = [
      {
        name: 'Default',
        text: typeof r.tagSystemPrompt === 'string' ? r.tagSystemPrompt : DEFAULT_TAG_SYSTEM_PROMPT
      }
    ]
  }
  const activeSystemPrompt =
    typeof r.activeSystemPrompt === 'string' &&
    systemPrompts.some((p) => p.name === r.activeSystemPrompt)
      ? r.activeSystemPrompt
      : systemPrompts[0].name

  // Dedicated image generation settings. When absent (legacy), seed temperature from the old
  // tagTemperature and leave reasoning off (matching the old tagDisableThinking default).
  const rawImgGen = (r.generation ?? {}) as Partial<GenerationSettings>
  const hasStoredGen = !!r.generation && typeof r.generation === 'object'
  const generation: GenerationSettings = {
    ...DEFAULT_IMAGE.generation,
    ...rawImgGen,
    temperature:
      typeof rawImgGen.temperature === 'number'
        ? rawImgGen.temperature
        : typeof r.tagTemperature === 'number'
          ? r.tagTemperature
          : DEFAULT_IMAGE.generation.temperature,
    reasoning_level: hasStoredGen ? migrateReasoning(rawImgGen) : 'off'
  }

  // Drop superseded legacy scalar keys so they don't linger in the written JSON.
  const rest: Record<string, unknown> = { ...r }
  for (const k of [
    'promptPrefix',
    'negativePrompt',
    'tagSystemPrompt',
    'tagTemperature',
    'tagDisableThinking',
    'tagInstruction'
  ]) {
    delete rest[k]
  }

  return {
    ...DEFAULT_IMAGE,
    ...(rest as Partial<ImageSettings>),
    appearanceSource: r.appearanceSource === 'appearance' ? 'appearance' : 'description',
    promptPrefixes,
    activePromptPrefix,
    systemPrompts,
    activeSystemPrompt,
    tagPrompts,
    activeTagPrompt,
    generation,
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

const DEFAULT_MODEL_PRESET: ModelPreset = {
  id: 'default',
  name: 'Default',
  provider: 'anthropic',
  model: defaultModelFor('anthropic'),
  generation: { ...DEFAULT_GENERATION }
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  selectedProvider: 'anthropic',
  models: {
    anthropic: defaultModelFor('anthropic'),
    openai: defaultModelFor('openai'),
    openrouter: defaultModelFor('openrouter'),
    deepseek: defaultModelFor('deepseek'),
    nanogpt: defaultModelFor('nanogpt')
  },
  activePresetId: null,
  generation: { ...DEFAULT_GENERATION },
  image: { ...DEFAULT_IMAGE },
  summarizer: { ...DEFAULT_SUMMARIZER },
  openrouter: { ...DEFAULT_OPENROUTER },
  modelPresets: [{ ...DEFAULT_MODEL_PRESET, generation: { ...DEFAULT_GENERATION } }],
  activeModelPresetId: 'default'
}

/** Deep-copy the default model-preset list so callers can't mutate shared references. */
function cloneModelPresets(presets: ModelPreset[]): ModelPreset[] {
  return presets.map((p) => ({ ...p, generation: { ...p.generation } }))
}

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'nanogpt']
function coerceProvider(v: unknown): ProviderId {
  return PROVIDER_IDS.includes(v as ProviderId) ? (v as ProviderId) : 'anthropic'
}

function mergeGeneration(raw: unknown): GenerationSettings {
  const g = (raw ?? {}) as Partial<GenerationSettings>
  return { ...DEFAULT_GENERATION, ...g, reasoning_level: migrateReasoning(g) }
}

/** The provider/model/generation the next LLM call should use, from the active model preset. */
export function resolveActiveModel(settings: WorkspaceSettings): {
  provider: ProviderId
  model: string
  generation: GenerationSettings
} {
  const presets = settings.modelPresets
  const active = presets.find((p) => p.id === settings.activeModelPresetId) ?? presets[0]
  return { provider: active.provider, model: active.model, generation: active.generation }
}

function mergeSettings(raw: unknown): WorkspaceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorkspaceSettings> & {
    activePromptId?: string | null
  }
  const generation = mergeGeneration(r.generation)
  const selectedProvider = r.selectedProvider ?? DEFAULT_SETTINGS.selectedProvider
  const models = { ...DEFAULT_SETTINGS.models, ...(r.models ?? {}) }

  // Model presets: keep valid entries; otherwise seed a "Default" from the legacy single config so
  // existing workspaces upgrade transparently.
  let modelPresets: ModelPreset[] = Array.isArray(r.modelPresets)
    ? r.modelPresets
        .filter(
          (p): p is ModelPreset =>
            !!p &&
            typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            typeof p.model === 'string'
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          provider: coerceProvider(p.provider),
          model: p.model,
          generation: mergeGeneration(p.generation)
        }))
    : []
  if (modelPresets.length === 0) {
    const seedProvider = coerceProvider(selectedProvider)
    modelPresets = [
      {
        id: 'default',
        name: 'Default',
        provider: seedProvider,
        model: models[seedProvider] || defaultModelFor(seedProvider),
        generation
      }
    ]
  }
  const activeModelPresetId =
    typeof r.activeModelPresetId === 'string' &&
    modelPresets.some((p) => p.id === r.activeModelPresetId)
      ? r.activeModelPresetId
      : modelPresets[0].id

  return {
    selectedProvider,
    models,
    // Back-compat: older settings used activePromptId.
    activePresetId: r.activePresetId ?? r.activePromptId ?? null,
    generation,
    image: mergeImage(r.image),
    summarizer: mergeSummarizer(r.summarizer),
    openrouter: mergeOpenRouter(r.openrouter),
    modelPresets,
    activeModelPresetId
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
    return {
      ...DEFAULT_SETTINGS,
      models: { ...DEFAULT_SETTINGS.models },
      modelPresets: cloneModelPresets(DEFAULT_SETTINGS.modelPresets)
    }
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

  ipcMain.handle('workspace:pick', async (e) => {
    const result = await showOpenDialog(e, {
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
