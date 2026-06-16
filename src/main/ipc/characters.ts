import { dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createCharacter,
  CharacterUpdate,
  deleteCharacter,
  exportCharacterCard,
  importCharacterFromPath,
  listCharacters,
  replaceAvatar,
  updateCharacter
} from '../lib/characterStorage'

export function registerCharactersIpc(): void {
  ipcMain.handle('characters:list', async (_e, workspace: string) => {
    return listCharacters(workspace)
  })

  ipcMain.handle('characters:pick-and-import', async (_e, workspace: string) => {
    const result = await dialog.showOpenDialog({
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

  ipcMain.handle('characters:pick-avatar', async (_e, workspace: string, id: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Choose avatar image',
      properties: ['openFile'],
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return replaceAvatar(workspace, id, result.filePaths[0])
  })

  ipcMain.handle('characters:export', async (_e, workspace: string, id: string, name: string) => {
    const result = await dialog.showSaveDialog({
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

  ipcMain.handle('characters:read-avatar', async (_e, workspace: string, avatarRelPath: string) => {
    const buf = await readFile(join(workspace, 'characters', avatarRelPath))
    return `data:image/png;base64,${buf.toString('base64')}`
  })
}
