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

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'deepseek' | 'nanogpt' | 'featherless'
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high'

export interface ModelInfo {
  id: string
  description?: string
}

export type BlockRole = 'system' | 'user' | 'assistant'
export type MarkerType =
  | 'char_description'
  | 'char_personality'
  | 'char_system_prompt'
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

/** A SillyTavern-compatible lorebook entry (World Info). Field names follow the standalone WI format. */
export interface LorebookEntry {
  uid: number
  key: string[]
  keysecondary: string[]
  comment: string
  content: string
  constant: boolean
  disable: boolean
  selective: boolean
  selectiveLogic: number
  order: number
  position: number
  depth: number
  role: number
  probability: number
  useProbability: boolean
  caseSensitive: boolean | null
  matchWholeWords: boolean | null
  scanDepth: number | null
  excludeRecursion: boolean
  preventRecursion: boolean
  extensions: Record<string, unknown>
}

export interface Lorebook {
  id: string
  name: string
  description: string
  scan_depth: number | null
  token_budget: number | null
  recursive_scanning: boolean
  entries: LorebookEntry[]
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

export interface SummarizerSettings {
  enabled: boolean
  minChapters: number
  batchSize: number
  confirmBeforeSummarizing: boolean
  prompt: string
  generation: GenerationSettings
  modelOverride: TagModelOverride
}

export interface OpenRouterSettings {
  order: string[]
  allowFallbacks: boolean
}

export interface ModelPreset {
  id: string
  name: string
  provider: ProviderId
  model: string
  generation: GenerationSettings
  notes: string
}

export interface WorkspaceSettings {
  selectedProvider: ProviderId
  models: Record<ProviderId, string>
  activePresetId: string | null
  generation: GenerationSettings
  image: ImageSettings
  summarizer: SummarizerSettings
  openrouter: OpenRouterSettings
  magicAutoStart: boolean
  magicBeatPrompt: string
  outlineToBeats: boolean
  modelPresets: ModelPreset[]
  activeModelPresetId: string | null
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

export interface PhotographOpts {
  mode: 'scene' | 'prompt'
  characterIds: string[]
  sceneText: string
  directPrompt: string
  systemPrompt: string
  tagInstruction: string
  prefixName: string
}

export interface PhotographResult {
  dataUrl: string
  positive: string
  negative: string
  tags: string
}

export interface GalleryImage {
  file: string
  prompt: string
  createdAt: string
}

export interface StoryGalleryImage {
  storySlug: string
  storyTitle: string
  relPath: string
  prompt: string
}

/** Identifies a gallery image to copy into a character's avatar. */
export type GalleryAvatarSource =
  | { kind: 'dedicated'; file: string }
  | { kind: 'story'; storySlug: string; relPath: string }

export interface StoryMeta {
  id: string
  slug: string
  title: string
  description: string
  tags: string[]
  character_ids: string[]
  preset_id: string | null
  plugin_ids: string[]
  lorebook_ids: string[]
  premise: string
  created_at: string
  updated_at: string
  notes: string
  summary: string
  summary_through_chapter: number | null
  /** Computed at list time (stories:list), not persisted. */
  chapterCount?: number
}

export interface Chapter {
  id: string
  number: number
  title: string
  outline: string
  content: string
  model_preset_id: string | null
  magic_beats: string[]
  magic_beats_done: number
  created_at: string
  updated_at: string
}

export interface StoryWithChapters {
  meta: StoryMeta
  chapters: Chapter[]
}

export interface GeneratedCharacter {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  tags: string[]
  appearance_tags: string
}

export type ApiLogKind =
  | 'test'
  | 'list-models'
  | 'continue'
  | 'continue-stream'
  | 'plan-beats'
  | 'suggest-outlines'
  | 'create-character'
  | 'image-tags'
  | 'image-generate'
  | 'summarize'
  | 'rewrite'

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
