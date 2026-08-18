import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'deepseek' | 'nanogpt'
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

export interface ModelInfo {
  id: string
  description?: string
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

function subscribe<TArgs extends unknown[]>(
  channel: string,
  handler: (...args: TArgs) => void
): () => void {
  const wrapped = (_e: IpcRendererEvent, ...args: unknown[]): void => handler(...(args as TArgs))
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api = {
  workspace: {
    getLast: (): Promise<string | null> => ipcRenderer.invoke('workspace:get-last'),
    pick: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick'),
    ensure: (path: string): Promise<boolean> => ipcRenderer.invoke('workspace:ensure', path),
    getSettings: (workspace: string): Promise<WorkspaceSettings> =>
      ipcRenderer.invoke('workspace:settings:get', workspace),
    setSettings: (workspace: string, settings: WorkspaceSettings): Promise<boolean> =>
      ipcRenderer.invoke('workspace:settings:set', workspace, settings)
  },
  characters: {
    list: (workspace: string): Promise<unknown[]> =>
      ipcRenderer.invoke('characters:list', workspace),
    pickAndImport: (workspace: string): Promise<unknown | null> =>
      ipcRenderer.invoke('characters:pick-and-import', workspace),
    create: (workspace: string, name?: string): Promise<unknown> =>
      ipcRenderer.invoke('characters:create', workspace, name),
    update: (workspace: string, id: string, patch: unknown): Promise<unknown> =>
      ipcRenderer.invoke('characters:update', workspace, id, patch),
    pickAvatar: (workspace: string, id: string): Promise<unknown | null> =>
      ipcRenderer.invoke('characters:pick-avatar', workspace, id),
    setAvatarFromGallery: (
      workspace: string,
      id: string,
      source:
        | { kind: 'dedicated'; file: string }
        | { kind: 'story'; storySlug: string; relPath: string }
    ): Promise<unknown> =>
      ipcRenderer.invoke('characters:set-avatar-from-gallery', workspace, id, source),
    exportCard: (workspace: string, id: string, name: string): Promise<string | null> =>
      ipcRenderer.invoke('characters:export', workspace, id, name),
    delete: (workspace: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke('characters:delete', workspace, id),
    readAvatar: (workspace: string, avatarRelPath: string): Promise<string> =>
      ipcRenderer.invoke('characters:read-avatar', workspace, avatarRelPath)
  },
  keys: {
    get: (provider: ProviderId): Promise<string | null> => ipcRenderer.invoke('keys:get', provider),
    set: (provider: ProviderId, key: string): Promise<boolean> =>
      ipcRenderer.invoke('keys:set', provider, key),
    delete: (provider: ProviderId): Promise<boolean> => ipcRenderer.invoke('keys:delete', provider),
    has: (): Promise<Record<ProviderId, boolean>> => ipcRenderer.invoke('keys:has')
  },
  providers: {
    test: (
      provider: ProviderId,
      model: string | null,
      overrideKey?: string,
      workspace?: string
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('providers:test', provider, model, overrideKey, workspace),
    listModels: (
      provider: ProviderId,
      overrideKey?: string,
      workspace?: string
    ): Promise<ModelInfo[]> =>
      ipcRenderer.invoke('providers:list-models', provider, overrideKey, workspace)
  },
  presets: {
    list: (workspace: string): Promise<Preset[]> => ipcRenderer.invoke('presets:list', workspace),
    get: (workspace: string, id: string): Promise<Preset | null> =>
      ipcRenderer.invoke('presets:get', workspace, id),
    create: (workspace: string, name: string): Promise<Preset> =>
      ipcRenderer.invoke('presets:create', workspace, name),
    save: (workspace: string, preset: Preset): Promise<Preset> =>
      ipcRenderer.invoke('presets:save', workspace, preset),
    delete: (workspace: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke('presets:delete', workspace, id),
    import: (workspace: string): Promise<Preset | null> =>
      ipcRenderer.invoke('presets:import', workspace),
    export: (workspace: string, id: string): Promise<string | null> =>
      ipcRenderer.invoke('presets:export', workspace, id)
  },
  plugins: {
    list: (workspace: string): Promise<Plugin[]> => ipcRenderer.invoke('plugins:list', workspace),
    get: (workspace: string, id: string): Promise<Plugin | null> =>
      ipcRenderer.invoke('plugins:get', workspace, id),
    create: (workspace: string, name: string): Promise<Plugin> =>
      ipcRenderer.invoke('plugins:create', workspace, name),
    save: (workspace: string, plugin: Plugin): Promise<Plugin> =>
      ipcRenderer.invoke('plugins:save', workspace, plugin),
    delete: (workspace: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke('plugins:delete', workspace, id)
  },
  lorebooks: {
    list: (workspace: string): Promise<Lorebook[]> =>
      ipcRenderer.invoke('lorebooks:list', workspace),
    get: (workspace: string, id: string): Promise<Lorebook | null> =>
      ipcRenderer.invoke('lorebooks:get', workspace, id),
    create: (workspace: string, name: string): Promise<Lorebook> =>
      ipcRenderer.invoke('lorebooks:create', workspace, name),
    save: (workspace: string, lorebook: Lorebook): Promise<Lorebook> =>
      ipcRenderer.invoke('lorebooks:save', workspace, lorebook),
    delete: (workspace: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke('lorebooks:delete', workspace, id),
    import: (workspace: string): Promise<Lorebook | null> =>
      ipcRenderer.invoke('lorebooks:import', workspace),
    export: (workspace: string, id: string): Promise<string | null> =>
      ipcRenderer.invoke('lorebooks:export', workspace, id)
  },
  stories: {
    list: (workspace: string): Promise<StoryMeta[]> =>
      ipcRenderer.invoke('stories:list', workspace),
    load: (workspace: string, id: string): Promise<StoryWithChapters | null> =>
      ipcRenderer.invoke('stories:load', workspace, id),
    create: (
      workspace: string,
      input: {
        title: string
        characterIds: string[]
        presetId: string | null
        pluginIds?: string[]
        lorebookIds?: string[]
        premise?: string
      }
    ): Promise<StoryWithChapters> => ipcRenderer.invoke('stories:create', workspace, input),
    updateMeta: (
      workspace: string,
      id: string,
      patch: {
        title?: string
        description?: string
        tags?: string[]
        characterIds?: string[]
        presetId?: string | null
        pluginIds?: string[]
        lorebookIds?: string[]
        premise?: string
        notes?: string
        summary?: string
        summaryThroughChapter?: number | null
      }
    ): Promise<StoryMeta> => ipcRenderer.invoke('stories:update-meta', workspace, id, patch),
    delete: (workspace: string, id: string): Promise<boolean> =>
      ipcRenderer.invoke('stories:delete', workspace, id),
    updateChapter: (
      workspace: string,
      storyId: string,
      chapterNumber: number,
      patch: {
        title?: string
        outline?: string
        content?: string
        model_preset_id?: string | null
        magic_beats?: string[]
        magic_beats_done?: number
      }
    ): Promise<Chapter> =>
      ipcRenderer.invoke('stories:update-chapter', workspace, storyId, chapterNumber, patch),
    appendChapter: (
      workspace: string,
      storyId: string,
      chapterNumber: number,
      text: string
    ): Promise<Chapter> =>
      ipcRenderer.invoke('stories:append-chapter', workspace, storyId, chapterNumber, text),
    addChapter: (workspace: string, storyId: string, title?: string): Promise<Chapter> =>
      ipcRenderer.invoke('stories:add-chapter', workspace, storyId, title),
    deleteChapter: (workspace: string, storyId: string, chapterNumber: number): Promise<boolean> =>
      ipcRenderer.invoke('stories:delete-chapter', workspace, storyId, chapterNumber)
  },
  generation: {
    continueStream: (
      workspace: string,
      storyId: string,
      chapterNumber: number,
      userNote?: string,
      beat?: string,
      beatIndex?: number,
      beatTotal?: number
    ): Promise<{ streamId: string } | { error: string }> =>
      ipcRenderer.invoke(
        'generation:continue-stream',
        workspace,
        storyId,
        chapterNumber,
        userNote,
        beat,
        beatIndex,
        beatTotal
      ),
    planBeats: (
      workspace: string,
      storyId: string,
      chapterNumber: number
    ): Promise<{ beats: string[] } | { error: string }> =>
      ipcRenderer.invoke('generation:plan-beats', workspace, storyId, chapterNumber),
    suggestOutlines: (
      workspace: string,
      storyId: string,
      chapterNumber: number,
      guidance?: string,
      beatCount?: number,
      outlineCount?: number
    ): Promise<{ outlines: string[][] } | { error: string }> =>
      ipcRenderer.invoke(
        'generation:suggest-outlines',
        workspace,
        storyId,
        chapterNumber,
        guidance,
        beatCount,
        outlineCount
      ),
    createCharacter: (
      workspace: string,
      prompt: string
    ): Promise<{ character: GeneratedCharacter } | { error: string }> =>
      ipcRenderer.invoke('generation:create-character', workspace, prompt),
    rewrite: (
      workspace: string,
      storyId: string,
      chapterNumber: number,
      passage: string,
      instruction: string
    ): Promise<{ text: string } | { error: string }> =>
      ipcRenderer.invoke(
        'generation:rewrite',
        workspace,
        storyId,
        chapterNumber,
        passage,
        instruction
      ),
    summarize: (
      workspace: string,
      storyId: string
    ): Promise<{ summary: string; summary_through_chapter: number } | { error: string }> =>
      ipcRenderer.invoke('generation:summarize', workspace, storyId),
    cancelSummarize: (): Promise<boolean> =>
      ipcRenderer.invoke('generation:cancel-summarize'),
    cancel: (streamId: string): Promise<boolean> =>
      ipcRenderer.invoke('generation:cancel', streamId),
    onDelta: (handler: (streamId: string, delta: string) => void): (() => void) =>
      subscribe<[string, string]>('generation:stream:delta', handler),
    onReasoning: (handler: (streamId: string, delta: string) => void): (() => void) =>
      subscribe<[string, string]>('generation:stream:reasoning', handler),
    onDone: (handler: (streamId: string, fullText: string) => void): (() => void) =>
      subscribe<[string, string]>('generation:stream:done', handler),
    onError: (handler: (streamId: string, error: string) => void): (() => void) =>
      subscribe<[string, string]>('generation:stream:error', handler)
  },
  comfy: {
    test: (url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('comfy:test', url),
    objectInfo: (url: string): Promise<ComfyObjectInfo | { error: string }> =>
      ipcRenderer.invoke('comfy:object-info', url),
    listWorkflows: (workspace: string): Promise<string[]> =>
      ipcRenderer.invoke('comfy:workflows:list', workspace),
    getWorkflow: (workspace: string, name: string): Promise<string> =>
      ipcRenderer.invoke('comfy:workflows:get', workspace, name),
    saveWorkflow: (workspace: string, name: string, json: string): Promise<string[]> =>
      ipcRenderer.invoke('comfy:workflows:save', workspace, name, json),
    deleteWorkflow: (workspace: string, name: string): Promise<string[]> =>
      ipcRenderer.invoke('comfy:workflows:delete', workspace, name)
  },
  image: {
    generate: (
      genId: string,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      passageText: string
    ): Promise<ImageGenResult | { error: string }> =>
      ipcRenderer.invoke('image:generate', genId, workspace, storyId, chapterNumber, passageText),
    photograph: (
      genId: string,
      workspace: string,
      opts: PhotographOpts
    ): Promise<PhotographResult | { error: string }> =>
      ipcRenderer.invoke('image:photograph', genId, workspace, opts),
    cancel: (genId: string): Promise<boolean> => ipcRenderer.invoke('image:cancel', genId),
    readFile: (workspace: string, storySlug: string, relPath: string): Promise<string | null> =>
      ipcRenderer.invoke('image:read-file', workspace, storySlug, relPath),
    onProgress: (handler: (genId: string, phase: ImagePhase) => void): (() => void) =>
      subscribe<[string, ImagePhase]>('image:progress', handler)
  },
  gallery: {
    list: (
      workspace: string,
      characterId: string
    ): Promise<{ dedicated: GalleryImage[]; stories: StoryGalleryImage[] }> =>
      ipcRenderer.invoke('gallery:list', workspace, characterId),
    read: (workspace: string, characterId: string, file: string): Promise<string | null> =>
      ipcRenderer.invoke('gallery:read', workspace, characterId, file),
    save: (
      workspace: string,
      characterId: string,
      dataUrl: string,
      prompt: string
    ): Promise<GalleryImage | { error: string }> =>
      ipcRenderer.invoke('gallery:save', workspace, characterId, dataUrl, prompt),
    delete: (workspace: string, characterId: string, file: string): Promise<boolean> =>
      ipcRenderer.invoke('gallery:delete', workspace, characterId, file)
  },
  debug: {
    // TEMPORARY: forward renderer focus diagnostics to the main-process terminal.
    log: (message: string): void => ipcRenderer.send('debug:log', message)
  },
  logs: {
    listRecent: (workspace: string, limit?: number): Promise<ApiLogEntry[]> =>
      ipcRenderer.invoke('logs:list-recent', workspace, limit),
    get: (workspace: string, id: string): Promise<ApiLogEntry | null> =>
      ipcRenderer.invoke('logs:get', workspace, id),
    reveal: (workspace: string): Promise<boolean> => ipcRenderer.invoke('logs:reveal', workspace),
    onAppended: (handler: (entry: ApiLogEntry) => void): (() => void) =>
      subscribe<[ApiLogEntry]>('logs:entry-appended', handler)
  }
}

export type StoryTavernApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
