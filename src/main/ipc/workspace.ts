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

export interface WorkspaceSettings {
  selectedProvider: ProviderId
  models: Record<ProviderId, string>
  activePresetId: string | null
  generation: GenerationSettings
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
  generation: { ...DEFAULT_GENERATION }
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
    generation
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
