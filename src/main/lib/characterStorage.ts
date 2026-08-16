import { copyFile, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { ulid } from 'ulid'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import {
  buildTavernCardPng,
  parseCardFromJson,
  parseCardFromPng,
  TavernCard,
  TavernV2Data
} from './tavernCard'

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

interface Frontmatter {
  id: string
  name: string
  slug: string
  created_at: string
  source: string
  avatar: string | null
  tavern_data: TavernV2Data
}

const EMPTY_TAVERN_DATA: TavernV2Data = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  character_book: null,
  tags: [],
  creator: '',
  character_version: '',
  extensions: {}
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
  return base || 'unnamed'
}

async function uniqueSlug(charactersDir: string, base: string, exclude?: string): Promise<string> {
  let slug = base
  let n = 2
  while (existsSync(join(charactersDir, `${slug}.md`)) && slug !== exclude) {
    slug = `${base}-${n}`
    n += 1
  }
  return slug
}

function buildMarkdown(fm: Frontmatter, body: string): string {
  const yaml = yamlDump(fm, { lineWidth: 0, noRefs: true })
  return `---\n${yaml}---\n\n${body}\n`
}

function parseMarkdown(text: string): { fm: Frontmatter; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('Character file missing frontmatter')
  const fm = yamlLoad(match[1]) as Frontmatter
  return { fm, body: match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '') }
}

function toCharacter(fm: Frontmatter, body: string): Character {
  return {
    id: fm.id,
    name: fm.name,
    slug: fm.slug,
    created_at: fm.created_at,
    source: fm.source as Character['source'],
    avatar: fm.avatar,
    tavern_data: fm.tavern_data,
    description: body
  }
}

export async function ensureCharactersDirs(workspace: string): Promise<void> {
  await mkdir(join(workspace, 'characters', 'avatars'), { recursive: true })
}

async function writeCharacterFile(workspace: string, fm: Frontmatter, body: string): Promise<void> {
  await ensureCharactersDirs(workspace)
  await writeFile(join(workspace, 'characters', `${fm.slug}.md`), buildMarkdown(fm, body), 'utf-8')
}

async function writeCharacter(
  workspace: string,
  card: TavernCard,
  sourcePngPath: string | null
): Promise<Character> {
  await ensureCharactersDirs(workspace)
  const charactersDir = join(workspace, 'characters')
  const avatarsDir = join(charactersDir, 'avatars')

  const name = card.data.name || 'Unnamed'
  const slug = await uniqueSlug(charactersDir, slugify(name))
  const id = ulid()
  const created_at = new Date().toISOString()

  let avatar: string | null = null
  if (sourcePngPath && extname(sourcePngPath).toLowerCase() === '.png') {
    const avatarName = `${slug}.png`
    await copyFile(sourcePngPath, join(avatarsDir, avatarName))
    avatar = `avatars/${avatarName}`
  }

  const source: Character['source'] =
    card.spec === 'chara_card_v3'
      ? 'tavern_card_v3'
      : card.spec === 'chara_card_v2'
        ? 'tavern_card_v2'
        : 'manual'

  const fm: Frontmatter = { id, name, slug, created_at, source, avatar, tavern_data: card.data }
  await writeCharacterFile(workspace, fm, card.data.description)
  return toCharacter(fm, card.data.description)
}

export async function importCharacterFromPath(
  workspace: string,
  filePath: string
): Promise<Character> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') {
    const card = await parseCardFromPng(filePath)
    return writeCharacter(workspace, card, filePath)
  }
  if (ext === '.json') {
    const text = await readFile(filePath, 'utf-8')
    const card = parseCardFromJson(text)
    return writeCharacter(workspace, card, null)
  }
  throw new Error(`Unsupported file extension: ${ext}`)
}

export async function createCharacter(
  workspace: string,
  initialName = 'Untitled'
): Promise<Character> {
  await ensureCharactersDirs(workspace)
  const charactersDir = join(workspace, 'characters')
  const slug = await uniqueSlug(charactersDir, slugify(initialName))
  const id = ulid()
  const created_at = new Date().toISOString()
  const tavern_data: TavernV2Data = { ...EMPTY_TAVERN_DATA, name: initialName }
  const fm: Frontmatter = {
    id,
    name: initialName,
    slug,
    created_at,
    source: 'manual',
    avatar: null,
    tavern_data
  }
  await writeCharacterFile(workspace, fm, '')
  return toCharacter(fm, '')
}

export async function listCharacters(workspace: string): Promise<Character[]> {
  const charactersDir = join(workspace, 'characters')
  if (!existsSync(charactersDir)) return []
  const entries = await readdir(charactersDir, { withFileTypes: true })
  const out: Character[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      const text = await readFile(join(charactersDir, entry.name), 'utf-8')
      const { fm, body } = parseMarkdown(text)
      out.push(toCharacter(fm, body))
    } catch {
      // skip malformed files
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

async function findById(workspace: string, id: string): Promise<Character | null> {
  const all = await listCharacters(workspace)
  return all.find((c) => c.id === id) ?? null
}

export interface CharacterUpdate {
  name?: string
  description?: string
  tavern_data?: Partial<TavernV2Data>
}

export async function updateCharacter(
  workspace: string,
  id: string,
  patch: CharacterUpdate
): Promise<Character> {
  const charactersDir = join(workspace, 'characters')
  const avatarsDir = join(charactersDir, 'avatars')
  const current = await findById(workspace, id)
  if (!current) throw new Error(`Character not found: ${id}`)

  const nextName = patch.name ?? current.name
  const nextDescription = patch.description ?? current.description
  const nextTavernData: TavernV2Data = {
    ...current.tavern_data,
    ...(patch.tavern_data ?? {}),
    // Merge extensions rather than replacing, so updating one namespaced block
    // (e.g. Story Tavern's image tags) doesn't drop others.
    extensions: {
      ...(current.tavern_data.extensions ?? {}),
      ...(patch.tavern_data?.extensions ?? {})
    },
    name: nextName,
    description: nextDescription
  }

  let nextSlug = current.slug
  let nextAvatar = current.avatar
  if (nextName !== current.name) {
    const wantedSlug = slugify(nextName)
    if (wantedSlug !== current.slug) {
      nextSlug = await uniqueSlug(charactersDir, wantedSlug, current.slug)
      // Rename markdown file
      await rename(join(charactersDir, `${current.slug}.md`), join(charactersDir, `${nextSlug}.md`))
      // Rename avatar if it followed the slug naming convention
      if (current.avatar && current.avatar === `avatars/${current.slug}.png`) {
        const newAvatarName = `${nextSlug}.png`
        await rename(join(avatarsDir, `${current.slug}.png`), join(avatarsDir, newAvatarName))
        nextAvatar = `avatars/${newAvatarName}`
      }
    }
  }

  const fm: Frontmatter = {
    id: current.id,
    name: nextName,
    slug: nextSlug,
    created_at: current.created_at,
    source: current.source,
    avatar: nextAvatar,
    tavern_data: nextTavernData
  }
  await writeCharacterFile(workspace, fm, nextDescription)
  return toCharacter(fm, nextDescription)
}

const AVATAR_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/**
 * Set a character's avatar from an existing image on disk (e.g. a gallery or story image), copying it
 * into the avatars folder. Unlike replaceAvatar (PNG-only, file-dialog sourced), this preserves the
 * source extension so jpg/webp story images work, and writes a UNIQUELY-named file (`<slug>-<ulid>.<ext>`)
 * so the stored avatar path always changes — that busts the renderer's path-keyed avatar cache so the
 * new image shows immediately. The previous avatar file is removed to avoid orphans.
 */
export async function setAvatarFromPath(
  workspace: string,
  id: string,
  sourcePath: string
): Promise<Character> {
  const ext = extname(sourcePath).toLowerCase()
  if (!AVATAR_EXTS.has(ext)) {
    throw new Error(`Unsupported avatar image type: ${ext || '(unknown)'}`)
  }
  const current = await findById(workspace, id)
  if (!current) throw new Error(`Character not found: ${id}`)
  const avatarsDir = join(workspace, 'characters', 'avatars')
  await mkdir(avatarsDir, { recursive: true })
  const avatarRel = `avatars/${current.slug}-${ulid()}${ext}`
  // Remove the previous avatar file (different name now) so old images don't pile up.
  if (current.avatar) {
    await rm(join(workspace, 'characters', current.avatar)).catch(() => {})
  }
  await copyFile(sourcePath, join(workspace, 'characters', avatarRel))
  const fm: Frontmatter = {
    id: current.id,
    name: current.name,
    slug: current.slug,
    created_at: current.created_at,
    source: current.source,
    avatar: avatarRel,
    tavern_data: current.tavern_data
  }
  await writeCharacterFile(workspace, fm, current.description)
  return toCharacter(fm, current.description)
}

export async function replaceAvatar(
  workspace: string,
  id: string,
  sourcePngPath: string
): Promise<Character> {
  if (extname(sourcePngPath).toLowerCase() !== '.png') {
    throw new Error('Only PNG avatars are supported (for now)')
  }
  const current = await findById(workspace, id)
  if (!current) throw new Error(`Character not found: ${id}`)
  const avatarsDir = join(workspace, 'characters', 'avatars')
  await mkdir(avatarsDir, { recursive: true })
  const avatarName = `${current.slug}.png`
  await copyFile(sourcePngPath, join(avatarsDir, avatarName))
  const fm: Frontmatter = {
    id: current.id,
    name: current.name,
    slug: current.slug,
    created_at: current.created_at,
    source: current.source,
    avatar: `avatars/${avatarName}`,
    tavern_data: current.tavern_data
  }
  await writeCharacterFile(workspace, fm, current.description)
  return toCharacter(fm, current.description)
}

export async function exportCharacterCard(
  workspace: string,
  id: string,
  outputPath: string
): Promise<void> {
  const current = await findById(workspace, id)
  if (!current) throw new Error(`Character not found: ${id}`)
  let avatarPng: Buffer | null = null
  if (current.avatar) {
    const avatarFullPath = join(workspace, 'characters', current.avatar)
    if (existsSync(avatarFullPath)) avatarPng = await readFile(avatarFullPath)
  }
  // Make sure the data block we embed reflects the latest name/description
  const data: TavernV2Data = {
    ...current.tavern_data,
    name: current.name,
    description: current.description
  }
  const png = buildTavernCardPng({ data, avatarPng })
  await writeFile(outputPath, png)
}

export async function deleteCharacter(workspace: string, id: string): Promise<void> {
  const charactersDir = join(workspace, 'characters')
  const target = await findById(workspace, id)
  if (!target) return
  await unlink(join(charactersDir, `${target.slug}.md`)).catch(() => {})
  if (target.avatar) {
    await unlink(join(charactersDir, target.avatar)).catch(() => {})
  }
  // Remove the character's dedicated gallery (id-keyed, so unaffected by slug renames).
  await rm(join(charactersDir, 'gallery', target.id), { recursive: true, force: true }).catch(
    () => {}
  )
}
