import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import type { TavernV2Data } from './tavernCard'

interface CharacterFrontmatter {
  id: string
  tavern_data: TavernV2Data
}

/**
 * Find a character by id in workspace/characters/*.md and return its Tavern V2
 * data, with the markdown body taking precedence over the embedded description
 * (mirrors how the editor stores the description as the file body).
 */
export async function readCharacterData(
  workspace: string,
  id: string | null
): Promise<TavernV2Data | null> {
  if (!id) return null
  const charactersDir = join(workspace, 'characters')
  if (!existsSync(charactersDir)) return null
  const entries = await readdir(charactersDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      const text = await readFile(join(charactersDir, entry.name), 'utf-8')
      const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      if (!match) continue
      const fm = yamlLoad(match[1]) as CharacterFrontmatter
      if (fm.id === id) {
        const body = match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '')
        return { ...fm.tavern_data, description: body || fm.tavern_data.description }
      }
    } catch {
      /* skip */
    }
  }
  return null
}

/** Appearance/negative tags Story Tavern stores in the card's extensions. */
export interface StoryTavernCharacterImage {
  appearance_tags?: string
  negative_tags?: string
}

export function readCharacterImageTags(character: TavernV2Data | null): StoryTavernCharacterImage {
  const ext = character?.extensions as Record<string, unknown> | undefined
  const block = ext?.story_tavern as StoryTavernCharacterImage | undefined
  return {
    appearance_tags: typeof block?.appearance_tags === 'string' ? block.appearance_tags : '',
    negative_tags: typeof block?.negative_tags === 'string' ? block.negative_tags : ''
  }
}
