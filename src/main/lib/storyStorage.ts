import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'

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

function withDefaults(
  meta: Partial<StoryMeta> & {
    id: string
    slug: string
    title: string
    prompt_id?: string | null
    /** Back-compat: stories created before multi-character support stored a single id. */
    character_id?: string | null
  }
): StoryMeta {
  return {
    id: meta.id,
    slug: meta.slug,
    title: meta.title,
    character_ids: Array.isArray(meta.character_ids)
      ? meta.character_ids
      : meta.character_id
        ? [meta.character_id]
        : [],
    // Back-compat: stories created before presets stored `prompt_id`. Reuse it as preset_id
    // since legacy prompts are migrated to presets with their original id.
    preset_id: meta.preset_id ?? meta.prompt_id ?? null,
    plugin_ids: Array.isArray(meta.plugin_ids) ? meta.plugin_ids : [],
    premise: typeof meta.premise === 'string' ? meta.premise : '',
    created_at: meta.created_at ?? new Date().toISOString(),
    updated_at: meta.updated_at ?? new Date().toISOString(),
    notes: typeof meta.notes === 'string' ? meta.notes : ''
  }
}

export interface Chapter {
  id: string
  number: number
  title: string
  /** Author's outline for this chapter — what should happen. Sent to the LLM as
   *  guidance for the active chapter (inline in the manuscript) and as an
   *  "upcoming chapters" block for future chapters that aren't written yet. */
  outline: string
  content: string
  created_at: string
  updated_at: string
}

interface ChapterFrontmatter {
  id: string
  number: number
  title: string
  outline?: string
  created_at: string
  updated_at: string
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
  return base || 'untitled-story'
}

function storiesDir(workspace: string): string {
  return join(workspace, 'stories')
}

function storyDir(workspace: string, slug: string): string {
  return join(storiesDir(workspace), slug)
}

function storyMetaPath(workspace: string, slug: string): string {
  return join(storyDir(workspace, slug), 'story.md')
}

function chapterPath(workspace: string, slug: string, number: number): string {
  return join(storyDir(workspace, slug), `chapter-${String(number).padStart(2, '0')}.md`)
}

function buildFrontmatterDoc<T>(fm: T, body: string): string {
  const yaml = yamlDump(fm, { lineWidth: 0, noRefs: true })
  return `---\n${yaml}---\n\n${body}\n`
}

function parseFrontmatterDoc<T>(text: string): { fm: T; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('Document missing frontmatter')
  const fm = yamlLoad(match[1]) as T
  return { fm, body: match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '') }
}

async function uniqueStorySlug(workspace: string, base: string): Promise<string> {
  let slug = base
  let n = 2
  while (existsSync(storyDir(workspace, slug))) {
    slug = `${base}-${n}`
    n += 1
  }
  return slug
}

async function writeStoryMeta(workspace: string, meta: StoryMeta): Promise<void> {
  await mkdir(storyDir(workspace, meta.slug), { recursive: true })
  const { notes, ...fm } = meta
  await writeFile(storyMetaPath(workspace, meta.slug), buildFrontmatterDoc(fm, notes), 'utf-8')
}

async function readStoryMeta(workspace: string, slug: string): Promise<StoryMeta | null> {
  const path = storyMetaPath(workspace, slug)
  if (!existsSync(path)) return null
  try {
    const { fm, body } = parseFrontmatterDoc<Partial<StoryMeta>>(await readFile(path, 'utf-8'))
    return withDefaults({
      ...fm,
      id: fm.id ?? '',
      slug,
      title: fm.title ?? 'Untitled story',
      notes: body
    })
  } catch {
    return null
  }
}

async function readChapter(
  workspace: string,
  slug: string,
  filename: string
): Promise<Chapter | null> {
  const path = join(storyDir(workspace, slug), filename)
  try {
    const { fm, body } = parseFrontmatterDoc<ChapterFrontmatter>(await readFile(path, 'utf-8'))
    return { ...fm, outline: typeof fm.outline === 'string' ? fm.outline : '', content: body }
  } catch {
    return null
  }
}

async function writeChapter(workspace: string, slug: string, chapter: Chapter): Promise<void> {
  const fm: ChapterFrontmatter = {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    outline: chapter.outline,
    created_at: chapter.created_at,
    updated_at: chapter.updated_at
  }
  await writeFile(
    chapterPath(workspace, slug, chapter.number),
    buildFrontmatterDoc(fm, chapter.content),
    'utf-8'
  )
}

export async function listStories(workspace: string): Promise<StoryMeta[]> {
  const dir = storiesDir(workspace)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const out: StoryMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const meta = await readStoryMeta(workspace, entry.name)
    if (meta) out.push(meta)
  }
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return out
}

export async function listChapters(workspace: string, slug: string): Promise<Chapter[]> {
  const dir = storyDir(workspace, slug)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const chapters: Chapter[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/^chapter-\d+\.md$/.test(entry.name)) continue
    const ch = await readChapter(workspace, slug, entry.name)
    if (ch) chapters.push(ch)
  }
  chapters.sort((a, b) => a.number - b.number)
  return chapters
}

export interface StoryWithChapters {
  meta: StoryMeta
  chapters: Chapter[]
}

export async function loadStory(workspace: string, id: string): Promise<StoryWithChapters | null> {
  const all = await listStories(workspace)
  const meta = all.find((s) => s.id === id)
  if (!meta) return null
  const chapters = await listChapters(workspace, meta.slug)
  return { meta, chapters }
}

export interface CreateStoryInput {
  title: string
  characterIds: string[]
  presetId: string | null
  pluginIds?: string[]
  premise?: string
}

export async function createStory(
  workspace: string,
  input: CreateStoryInput
): Promise<StoryWithChapters> {
  await mkdir(storiesDir(workspace), { recursive: true })
  const slug = await uniqueStorySlug(workspace, slugify(input.title))
  const now = new Date().toISOString()
  const meta: StoryMeta = withDefaults({
    id: ulid(),
    slug,
    title: input.title.trim() || 'Untitled story',
    character_ids: input.characterIds,
    preset_id: input.presetId,
    plugin_ids: input.pluginIds ?? [],
    premise: input.premise ?? '',
    created_at: now,
    updated_at: now
  })
  await writeStoryMeta(workspace, meta)
  // Seed with an empty Chapter 1
  const chapter: Chapter = {
    id: ulid(),
    number: 1,
    title: 'Chapter 1',
    outline: '',
    content: '',
    created_at: now,
    updated_at: now
  }
  await writeChapter(workspace, slug, chapter)
  return { meta, chapters: [chapter] }
}

export interface StoryMetaUpdate {
  title?: string
  characterIds?: string[]
  presetId?: string | null
  pluginIds?: string[]
  premise?: string
  notes?: string
}

export async function updateStoryMeta(
  workspace: string,
  id: string,
  patch: StoryMetaUpdate
): Promise<StoryMeta> {
  const all = await listStories(workspace)
  const current = all.find((s) => s.id === id)
  if (!current) throw new Error(`Story not found: ${id}`)
  let nextSlug = current.slug
  const nextTitle = patch.title?.trim() || current.title
  if (patch.title !== undefined && nextTitle !== current.title) {
    const wantedSlug = slugify(nextTitle)
    if (wantedSlug !== current.slug) {
      nextSlug = await uniqueStorySlug(workspace, wantedSlug)
      await rename(storyDir(workspace, current.slug), storyDir(workspace, nextSlug))
    }
  }
  const updated: StoryMeta = {
    ...current,
    slug: nextSlug,
    title: nextTitle,
    character_ids: patch.characterIds !== undefined ? patch.characterIds : current.character_ids,
    preset_id: patch.presetId !== undefined ? patch.presetId : current.preset_id,
    plugin_ids: patch.pluginIds !== undefined ? patch.pluginIds : current.plugin_ids,
    premise: patch.premise !== undefined ? patch.premise : current.premise,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    updated_at: new Date().toISOString()
  }
  await writeStoryMeta(workspace, updated)
  return updated
}

export async function deleteStory(workspace: string, id: string): Promise<void> {
  const all = await listStories(workspace)
  const meta = all.find((s) => s.id === id)
  if (!meta) return
  await rm(storyDir(workspace, meta.slug), { recursive: true, force: true })
}

export interface UpdateChapterInput {
  title?: string
  outline?: string
  content?: string
}

export async function updateChapter(
  workspace: string,
  storyId: string,
  chapterNumber: number,
  patch: UpdateChapterInput
): Promise<Chapter> {
  const story = await loadStory(workspace, storyId)
  if (!story) throw new Error(`Story not found: ${storyId}`)
  const chapter = story.chapters.find((c) => c.number === chapterNumber)
  if (!chapter) throw new Error(`Chapter ${chapterNumber} not found`)
  const updated: Chapter = {
    ...chapter,
    title: patch.title !== undefined ? patch.title : chapter.title,
    outline: patch.outline !== undefined ? patch.outline : chapter.outline,
    content: patch.content !== undefined ? patch.content : chapter.content,
    updated_at: new Date().toISOString()
  }
  await writeChapter(workspace, story.meta.slug, updated)
  // bump story updated_at too
  await updateStoryMeta(workspace, storyId, {})
  return updated
}

export async function appendToChapter(
  workspace: string,
  storyId: string,
  chapterNumber: number,
  textToAppend: string
): Promise<Chapter> {
  const story = await loadStory(workspace, storyId)
  if (!story) throw new Error(`Story not found: ${storyId}`)
  const chapter = story.chapters.find((c) => c.number === chapterNumber)
  if (!chapter) throw new Error(`Chapter ${chapterNumber} not found`)
  const sep =
    chapter.content && !chapter.content.endsWith('\n') && !textToAppend.startsWith('\n') ? '' : ''
  return updateChapter(workspace, storyId, chapterNumber, {
    content: chapter.content + sep + textToAppend
  })
}

export async function addChapter(
  workspace: string,
  storyId: string,
  title?: string
): Promise<Chapter> {
  const story = await loadStory(workspace, storyId)
  if (!story) throw new Error(`Story not found: ${storyId}`)
  const nextNumber =
    story.chapters.length === 0 ? 1 : Math.max(...story.chapters.map((c) => c.number)) + 1
  const now = new Date().toISOString()
  const chapter: Chapter = {
    id: ulid(),
    number: nextNumber,
    title: title ?? `Chapter ${nextNumber}`,
    outline: '',
    content: '',
    created_at: now,
    updated_at: now
  }
  await writeChapter(workspace, story.meta.slug, chapter)
  await updateStoryMeta(workspace, storyId, {})
  return chapter
}

export async function deleteChapter(
  workspace: string,
  storyId: string,
  chapterNumber: number
): Promise<void> {
  const story = await loadStory(workspace, storyId)
  if (!story) return
  if (story.chapters.length <= 1) {
    throw new Error('Cannot delete the only chapter; delete the story instead')
  }
  const dir = storyDir(workspace, story.meta.slug)
  await rm(join(dir, `chapter-${String(chapterNumber).padStart(2, '0')}.md`), { force: true })
}
