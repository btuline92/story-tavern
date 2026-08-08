import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { listChapters, listStories } from '../lib/storyStorage'
import { mimeForExt } from './image'

/** A picture saved into a character's dedicated gallery. */
export interface GalleryImage {
  /** Filename inside characters/gallery/<id>/. */
  file: string
  /** Positive prompt captured at save time (from a sidecar JSON). */
  prompt: string
  createdAt: string
}

/** A picture auto-collected from a story the character is a cast member of (read-only). */
export interface StoryGalleryImage {
  storySlug: string
  storyTitle: string
  /** Path relative to the story dir, e.g. images/<ulid>.png (for image:read-file). */
  relPath: string
  prompt: string
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
// Same shape as ChapterDocument's IMAGE_RE — captures src (group 1) and title/prompt (group 2).
const MARKER_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

function galleryDir(workspace: string, characterId: string): string {
  return join(workspace, 'characters', 'gallery', characterId)
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.includes(extOf(name))
}

/** Reject ids/files that could escape the gallery dir. */
function unsafe(...segments: string[]): boolean {
  return segments.some((s) => !s || s.includes('..') || s.includes('/') || s.includes('\\'))
}

async function listDedicated(workspace: string, characterId: string): Promise<GalleryImage[]> {
  const dir = galleryDir(workspace, characterId)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const images: GalleryImage[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isImage(entry.name)) continue
    const base = entry.name.slice(0, -(extOf(entry.name).length + 1))
    let prompt = ''
    let createdAt = ''
    const sidecar = join(dir, `${base}.json`)
    if (existsSync(sidecar)) {
      try {
        const meta = JSON.parse(await readFile(sidecar, 'utf-8')) as {
          prompt?: unknown
          createdAt?: unknown
        }
        prompt = typeof meta.prompt === 'string' ? meta.prompt : ''
        createdAt = typeof meta.createdAt === 'string' ? meta.createdAt : ''
      } catch {
        /* ignore malformed sidecar */
      }
    }
    images.push({ file: entry.name, prompt, createdAt })
  }
  // Newest first — createdAt when present, else the filename (ULIDs are lexically time-sortable).
  images.sort((a, b) => (b.createdAt || b.file).localeCompare(a.createdAt || a.file))
  return images
}

/** Map images/<file> → its positive prompt by scanning the story's chapter markdown markers. */
async function buildPromptMap(workspace: string, slug: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const chapters = await listChapters(workspace, slug)
  for (const ch of chapters) {
    MARKER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MARKER_RE.exec(ch.content)) !== null) {
      map[m[1]] = m[2] ?? ''
    }
  }
  return map
}

async function listStoryImages(
  workspace: string,
  characterId: string
): Promise<StoryGalleryImage[]> {
  const stories = await listStories(workspace)
  const out: StoryGalleryImage[] = []
  for (const meta of stories) {
    if (!meta.character_ids.includes(characterId)) continue
    const imagesDir = join(workspace, 'stories', meta.slug, 'images')
    if (!existsSync(imagesDir)) continue
    const promptByRel = await buildPromptMap(workspace, meta.slug)
    const entries = await readdir(imagesDir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && isImage(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a)) // newest first (ULID)
    for (const file of files) {
      const relPath = `images/${file}`
      out.push({
        storySlug: meta.slug,
        storyTitle: meta.title,
        relPath,
        prompt: promptByRel[relPath] ?? ''
      })
    }
  }
  return out
}

export function registerGalleryIpc(): void {
  ipcMain.handle(
    'gallery:list',
    async (
      _e,
      workspace: string,
      characterId: string
    ): Promise<{ dedicated: GalleryImage[]; stories: StoryGalleryImage[] }> => {
      if (unsafe(characterId)) return { dedicated: [], stories: [] }
      const [dedicated, stories] = await Promise.all([
        listDedicated(workspace, characterId),
        listStoryImages(workspace, characterId)
      ])
      return { dedicated, stories }
    }
  )

  ipcMain.handle(
    'gallery:read',
    async (_e, workspace: string, characterId: string, file: string): Promise<string | null> => {
      if (unsafe(characterId, file)) return null
      const full = join(galleryDir(workspace, characterId), file)
      if (!existsSync(full)) return null
      const buf = await readFile(full)
      return `data:${mimeForExt(extOf(file) || 'png')};base64,${buf.toString('base64')}`
    }
  )

  ipcMain.handle(
    'gallery:save',
    async (
      _e,
      workspace: string,
      characterId: string,
      dataUrl: string,
      prompt: string
    ): Promise<GalleryImage | { error: string }> => {
      if (unsafe(characterId)) return { error: 'Invalid character id.' }
      const dir = galleryDir(workspace, characterId)
      await mkdir(dir, { recursive: true })
      // Accept either a full data URL or raw base64.
      const comma = dataUrl.indexOf(',')
      const raw = dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
      const id = ulid()
      const file = `${id}.png`
      const createdAt = new Date().toISOString()
      await writeFile(join(dir, file), Buffer.from(raw, 'base64'))
      await writeFile(
        join(dir, `${id}.json`),
        JSON.stringify({ prompt: prompt ?? '', createdAt }, null, 2),
        'utf-8'
      )
      return { file, prompt: prompt ?? '', createdAt }
    }
  )

  ipcMain.handle(
    'gallery:delete',
    async (_e, workspace: string, characterId: string, file: string): Promise<boolean> => {
      if (unsafe(characterId, file)) return false
      const dir = galleryDir(workspace, characterId)
      await rm(join(dir, file), { force: true }).catch(() => {})
      const base = file.slice(0, -(extOf(file).length + 1))
      if (base) await rm(join(dir, `${base}.json`), { force: true }).catch(() => {})
      return true
    }
  )
}
