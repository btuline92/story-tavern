import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { showOpenDialog, showSaveDialog } from '../lib/dialogs'
import { extname, join } from 'node:path'
import {
  createCharacter,
  CharacterUpdate,
  deleteCharacter,
  exportCharacterCard,
  importCharacterFromPath,
  listCharacters,
  replaceAvatar,
  setAvatarFromPath,
  updateCharacter
} from '../lib/characterStorage'

/** Identifies a gallery image to copy into a character's avatar (mirrors the renderer union). */
type GalleryAvatarSource =
  | { kind: 'dedicated'; file: string }
  | { kind: 'story'; storySlug: string; relPath: string }

const AVATAR_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png': 'image/png'
}

export function registerCharactersIpc(): void {
  ipcMain.handle('characters:list', async (_e, workspace: string) => {
    return listCharacters(workspace)
  })

  ipcMain.handle('characters:pick-and-import', async (e, workspace: string) => {
    const result = await showOpenDialog(e, {
      title: 'Import character card',
      properties: ['openFile'],
      filters: [
        { name: 'Character cards', extensions: ['png', 'json'] },
        { name: 'PNG', extensions: ['png'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importCharacterFromPath(workspace, result.filePaths[0])
  })

  ipcMain.handle('characters:create', async (_e, workspace: string, name?: string) => {
    return createCharacter(workspace, name ?? 'Untitled')
  })

  ipcMain.handle(
    'characters:update',
    async (_e, workspace: string, id: string, patch: CharacterUpdate) => {
      return updateCharacter(workspace, id, patch)
    }
  )

  ipcMain.handle('characters:pick-avatar', async (e, workspace: string, id: string) => {
    const result = await showOpenDialog(e, {
      title: 'Choose avatar image',
      properties: ['openFile'],
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return replaceAvatar(workspace, id, result.filePaths[0])
  })

  ipcMain.handle('characters:export', async (e, workspace: string, id: string, name: string) => {
    const result = await showSaveDialog(e, {
      title: 'Export as Tavern card',
      defaultPath: `${name}.png`,
      filters: [{ name: 'Tavern PNG card', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return null
    await exportCharacterCard(workspace, id, result.filePath)
    return result.filePath
  })

  ipcMain.handle('characters:delete', async (_e, workspace: string, id: string) => {
    await deleteCharacter(workspace, id)
    return true
  })

  // Copy a gallery/story image into the given character's avatar (no file dialog).
  ipcMain.handle(
    'characters:set-avatar-from-gallery',
    async (_e, workspace: string, id: string, source: GalleryAvatarSource) => {
      const parts =
        source.kind === 'dedicated'
          ? ['characters', 'gallery', id, source.file]
          : ['stories', source.storySlug, source.relPath]
      // Reject path traversal from the renderer-supplied filename/relPath.
      if (parts.some((p) => typeof p !== 'string' || p.includes('..'))) {
        throw new Error('Invalid image path')
      }
      return setAvatarFromPath(workspace, id, join(workspace, ...parts))
    }
  )

  ipcMain.handle('characters:read-avatar', async (_e, workspace: string, avatarRelPath: string) => {
    const buf = await readFile(join(workspace, 'characters', avatarRelPath))
    const mime = AVATAR_MIME[extname(avatarRelPath).toLowerCase()] ?? 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  })
}
