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
  // LLM tag generation
  tagSystemPrompt: string
  tagInstruction: string
  tagTemperature: number
  tagModelOverride: TagModelOverride
}

export interface WorkspaceSettings {
  selectedProvider: ProviderId
  models: Record<ProviderId, string>
  activePresetId: string | null
  generation: GenerationSettings
  image: ImageSettings
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

const DEFAULT_TAG_SYSTEM_PROMPT = `You are a Stable Diffusion prompt generator. Your response must contain ONLY comma-separated Danbooru-style tags. Do not respond with anything other than the tag list. NO sentences, NO commentary, NO explanations, NO preamble. Your entire reply is the tag list and nothing else.

CRITICAL: Every single tag MUST be separated by a comma. Tags MUST be kept short at 2-3 tokens maximum length. Do NOT use spaces alone, newlines, or any other separator between tags. The output is a single line of comma-separated tags. Example format: tag1, tag2, tag3, tag4,

Structure rules:
1. Begin with tags describing the scene/background: location, time of day, lighting, atmosphere.
2. Include a gender count tag in Danbooru format for the characters visible in the scene: e.g. "1girl," or "1boy, 1girl,".
3. After the scene tags, describe the focal character: appearance (reproduce any provided appearance tag list exactly, for visual consistency), then pose, clothing state, expression, and current action.
4. Focus on what is literally visible: pose, clothing, physical interaction, and immediate background elements.
5. Max 40 tags total.
6. End the output with a trailing comma.

You MUST output the tags directly as your response. Do not summarize. Just write the comma-separated tags.`

const DEFAULT_TAG_INSTRUCTION = `Convert the current moment of the story (the most recent passage below) into a Stable Diffusion prompt. Begin with scene/background tags, then describe the focal character and their current pose, clothing, expression, and action. If an appearance tag list is provided for the character, reproduce it exactly for consistency. Keep it concise. End with a trailing comma.`

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
  tagSystemPrompt: DEFAULT_TAG_SYSTEM_PROMPT,
  tagInstruction: DEFAULT_TAG_INSTRUCTION,
  tagTemperature: 0.3,
  tagModelOverride: { enabled: false, provider: 'anthropic', model: '' }
}

function mergeImage(raw: unknown): ImageSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImageSettings>
  const rawOverride = (r.tagModelOverride ?? {}) as Partial<TagModelOverride>
  return {
    ...DEFAULT_IMAGE,
    ...r,
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
  image: { ...DEFAULT_IMAGE }
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
    image: mergeImage(r.image)
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
