import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'

export type BlockRole = 'system' | 'user' | 'assistant'

export type MarkerType =
  | 'char_description'
  | 'char_personality'
  | 'scenario'
  | 'dialogue_examples'
  | 'story_premise'
  | 'manuscript'
  | 'unsupported'

export interface PromptBlock {
  id: string
  name: string
  role: BlockRole
  content: string
  marker: boolean
  markerType: MarkerType | null
  enabled: boolean
  // Preserved for round-trip export to SillyTavern.
  stIdentifier?: string
  stInjectionPosition?: number
  stInjectionDepth?: number
}

export interface Preset {
  id: string
  name: string
  blocks: PromptBlock[]
  created_at: string
  updated_at: string
}

interface PresetsFile {
  presets: Preset[]
}

function presetsPath(workspace: string): string {
  return join(workspace, 'presets.json')
}

function legacyPromptsPath(workspace: string): string {
  return join(workspace, 'prompts.json')
}

// --- SillyTavern interop ---

const ST_MARKER_MAP: Record<string, MarkerType> = {
  charDescription: 'char_description',
  charPersonality: 'char_personality',
  scenario: 'scenario',
  dialogueExamples: 'dialogue_examples',
  chatHistory: 'manuscript',
  // Story Tavern extension — lets our premise marker round-trip through import/export.
  storyPremise: 'story_premise',
  personaDescription: 'unsupported',
  worldInfoBefore: 'unsupported',
  worldInfoAfter: 'unsupported',
  enhanceDefinitions: 'unsupported',
  nsfw: 'unsupported',
  jailbreak: 'unsupported'
}

const MARKER_TO_ST: Partial<Record<MarkerType, string>> = {
  char_description: 'charDescription',
  char_personality: 'charPersonality',
  scenario: 'scenario',
  dialogue_examples: 'dialogueExamples',
  manuscript: 'chatHistory',
  story_premise: 'storyPremise'
}

function normalizeRole(role: unknown): BlockRole {
  return role === 'user' || role === 'assistant' ? role : 'system'
}

interface StPrompt {
  identifier?: string
  name?: string
  system_prompt?: boolean
  marker?: boolean
  content?: string
  role?: string
  injection_position?: number
  injection_depth?: number
}

interface StPreset {
  prompts?: StPrompt[]
  prompt_order?: Array<{ character_id?: number; order?: Array<{ identifier: string; enabled?: boolean }> }>
}

export function importFromSillyTavern(json: unknown, fallbackName: string): Preset {
  const st = (json && typeof json === 'object' ? json : {}) as StPreset
  const byId = new Map<string, StPrompt>()
  for (const p of st.prompts ?? []) {
    if (p.identifier) byId.set(p.identifier, p)
  }
  const order = st.prompt_order?.[0]?.order ?? []
  const blocks: PromptBlock[] = []

  const pushBlock = (p: StPrompt, enabled: boolean): void => {
    const isMarker = p.marker === true
    blocks.push({
      id: ulid(),
      name: p.name ?? p.identifier ?? 'Block',
      role: normalizeRole(p.role),
      content: typeof p.content === 'string' ? p.content : '',
      marker: isMarker,
      markerType: isMarker ? (ST_MARKER_MAP[p.identifier ?? ''] ?? 'unsupported') : null,
      enabled,
      stIdentifier: p.identifier,
      stInjectionPosition: p.injection_position,
      stInjectionDepth: p.injection_depth
    })
  }

  if (order.length > 0) {
    for (const entry of order) {
      const p = byId.get(entry.identifier)
      if (!p) continue
      pushBlock(p, entry.enabled !== false)
    }
  } else {
    // No order block — fall back to the prompts array order.
    for (const p of st.prompts ?? []) pushBlock(p, true)
  }

  const now = new Date().toISOString()
  return {
    id: ulid(),
    name: fallbackName.trim() || 'Imported preset',
    blocks,
    created_at: now,
    updated_at: now
  }
}

export function exportToSillyTavern(preset: Preset): StPreset {
  const prompts: StPrompt[] = preset.blocks.map((b) => {
    const identifier =
      b.stIdentifier ?? (b.marker ? (MARKER_TO_ST[b.markerType ?? 'unsupported'] ?? b.id) : b.id)
    const p: StPrompt = {
      identifier,
      name: b.name,
      system_prompt: b.role === 'system' || b.marker,
      marker: b.marker,
      role: b.role,
      injection_position: b.stInjectionPosition ?? 0,
      injection_depth: b.stInjectionDepth ?? 4
    }
    if (!b.marker) p.content = b.content
    return p
  })
  const order = preset.blocks.map((b) => ({
    identifier:
      b.stIdentifier ?? (b.marker ? (MARKER_TO_ST[b.markerType ?? 'unsupported'] ?? b.id) : b.id),
    enabled: b.enabled
  }))
  return { prompts, prompt_order: [{ character_id: 100001, order }] }
}

// --- Default preset (used when a story has no preset assigned) ---

export function defaultPreset(): Preset {
  const now = new Date().toISOString()
  const mk = (
    partial: Omit<PromptBlock, 'id' | 'enabled'> & { enabled?: boolean }
  ): PromptBlock => ({ id: ulid(), enabled: true, ...partial })
  return {
    id: 'default',
    name: 'Default (longform prose)',
    created_at: now,
    updated_at: now,
    blocks: [
      mk({
        name: 'Main instructions',
        role: 'system',
        marker: false,
        markerType: null,
        content:
          'You are a skilled longform fiction writer. Continue the manuscript in the same voice, tone, tense, and point of view. Write flowing prose. Do not summarize, do not add meta-commentary, and do not insert chapter headings unless the prose itself calls for one.'
      }),
      mk({ name: 'Story premise', role: 'system', marker: true, markerType: 'story_premise', content: '' }),
      mk({
        name: 'Character description',
        role: 'system',
        marker: true,
        markerType: 'char_description',
        content: ''
      }),
      mk({
        name: 'Character personality',
        role: 'system',
        marker: true,
        markerType: 'char_personality',
        content: ''
      }),
      mk({ name: 'Scenario', role: 'system', marker: true, markerType: 'scenario', content: '' }),
      mk({ name: 'Manuscript', role: 'user', marker: true, markerType: 'manuscript', content: '' })
    ]
  }
}

// --- CRUD ---

async function migrateLegacyPrompts(workspace: string): Promise<Preset[]> {
  const legacy = legacyPromptsPath(workspace)
  if (!existsSync(legacy)) return []
  try {
    const raw = JSON.parse(await readFile(legacy, 'utf-8')) as {
      prompts?: Array<{ id: string; name: string; content: string; created_at?: string; updated_at?: string }>
    }
    return (raw.prompts ?? []).map((p) => ({
      id: p.id, // reuse id so existing story.prompt_id references still resolve
      name: p.name,
      created_at: p.created_at ?? new Date().toISOString(),
      updated_at: p.updated_at ?? new Date().toISOString(),
      blocks: [
        {
          id: ulid(),
          name: 'Main',
          role: 'system' as BlockRole,
          content: p.content,
          marker: false,
          markerType: null,
          enabled: true
        },
        {
          id: ulid(),
          name: 'Manuscript',
          role: 'user' as BlockRole,
          content: '',
          marker: true,
          markerType: 'manuscript' as MarkerType,
          enabled: true
        }
      ]
    }))
  } catch {
    return []
  }
}

async function readFileOrMigrate(workspace: string): Promise<PresetsFile> {
  const path = presetsPath(workspace)
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(await readFile(path, 'utf-8')) as PresetsFile
      if (raw && Array.isArray(raw.presets)) return raw
    } catch {
      /* fall through */
    }
    return { presets: [] }
  }
  // First run with the new model: migrate any legacy flat prompts.
  const migrated = await migrateLegacyPrompts(workspace)
  if (migrated.length > 0) {
    const file = { presets: migrated }
    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8')
    return file
  }
  return { presets: [] }
}

async function writePresetsFile(workspace: string, file: PresetsFile): Promise<void> {
  await writeFile(presetsPath(workspace), JSON.stringify(file, null, 2), 'utf-8')
}

export async function listPresets(workspace: string): Promise<Preset[]> {
  const file = await readFileOrMigrate(workspace)
  return file.presets.slice().sort((a, b) => a.name.localeCompare(b.name))
}

export async function getPreset(workspace: string, id: string): Promise<Preset | null> {
  const file = await readFileOrMigrate(workspace)
  return file.presets.find((p) => p.id === id) ?? null
}

export async function createPreset(workspace: string, name: string): Promise<Preset> {
  const file = await readFileOrMigrate(workspace)
  const now = new Date().toISOString()
  const preset: Preset = {
    id: ulid(),
    name: name.trim() || 'New preset',
    blocks: defaultPreset().blocks.map((b) => ({ ...b, id: ulid() })),
    created_at: now,
    updated_at: now
  }
  file.presets.push(preset)
  await writePresetsFile(workspace, file)
  return preset
}

export async function savePreset(workspace: string, preset: Preset): Promise<Preset> {
  const file = await readFileOrMigrate(workspace)
  const idx = file.presets.findIndex((p) => p.id === preset.id)
  const updated = { ...preset, updated_at: new Date().toISOString() }
  if (idx === -1) file.presets.push(updated)
  else file.presets[idx] = updated
  await writePresetsFile(workspace, file)
  return updated
}

export async function deletePreset(workspace: string, id: string): Promise<boolean> {
  const file = await readFileOrMigrate(workspace)
  const before = file.presets.length
  file.presets = file.presets.filter((p) => p.id !== id)
  if (file.presets.length === before) return false
  await writePresetsFile(workspace, file)
  return true
}

export async function importPreset(
  workspace: string,
  json: unknown,
  fallbackName: string
): Promise<Preset> {
  const preset = importFromSillyTavern(json, fallbackName)
  const file = await readFileOrMigrate(workspace)
  file.presets.push(preset)
  await writePresetsFile(workspace, file)
  return preset
}
