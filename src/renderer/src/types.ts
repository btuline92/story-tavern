export interface TavernV2Data {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  character_book: Record<string, unknown> | null
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
}

export interface Character {
  id: string
  name: string
  slug: string
  created_at: string
  source: 'tavern_card_v2' | 'tavern_card_v3' | 'manual'
  avatar: string | null
  tavern_data: TavernV2Data
  description: string
}

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'deepseek'
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

export interface ModelInfo {
  id: string
  description?: string
}

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

export interface Plugin {
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

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

export interface PromptPrefix {
  name: string
  positive: string
  negative: string
}

export interface SystemPrompt {
  name: string
  text: string
}

export interface ImageSettings {
  enabled: boolean
  autoAfterContinue: boolean
  comfyUrl: string
  workflow: string
  model: string
  vae: string
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  width: number
  height: number
  clipSkip: number
  seed: number
  denoise: number
  customPlaceholders: CustomPlaceholder[]
  promptPrefixes: PromptPrefix[]
  activePromptPrefix: string
  appearanceSource: 'description' | 'appearance'
  systemPrompts: SystemPrompt[]
  activeSystemPrompt: string
  tagPrompts: TagPrompt[]
  activeTagPrompt: string
  generation: GenerationSettings
  tagModelOverride: TagModelOverride
}

export interface OpenRouterSettings {
  order: string[]
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

export interface ComfyObjectInfo {
  samplers: string[]
  schedulers: string[]
  models: string[]
  vaes: string[]
}

export type ImagePhase = 'tagging' | 'generating' | 'saving'

export interface ImageGenResult {
  relPath: string
  positive: string
  negative: string
  tags: string
}

export interface StoryMeta {
  id: string
  slug: string
  title: string
  character_ids: string[]
  preset_id: string | null
  plugin_ids: string[]
  premise: string
  created_at: string
  updated_at: string
  notes: string
}

export interface Chapter {
  id: string
  number: number
  title: string
  outline: string
  content: string
  created_at: string
  updated_at: string
}

export interface StoryWithChapters {
  meta: StoryMeta
  chapters: Chapter[]
}

export type ApiLogKind =
  | 'test'
  | 'list-models'
  | 'continue'
  | 'continue-stream'
  | 'plan-beats'
  | 'suggest-outlines'
  | 'image-tags'
  | 'image-generate'

export interface ApiLogEntry {
  id: string
  ts: string
  provider: string
  model: string | null
  kind: ApiLogKind
  url: string
  request_body_preview: string | null
  request_body_size: number
  status: number | null
  response_body_preview: string | null
  response_body_size: number
  error: string | null
  duration_ms: number
  story_id?: string
  chapter_number?: number
  stream_chunks?: number
  request_body?: string
  response_body?: string
}
