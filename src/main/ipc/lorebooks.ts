import { ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { showOpenDialog, showSaveDialog } from '../lib/dialogs'
import {
  createLorebook,
  deleteLorebook,
  getLorebook,
  importLorebook,
  listLorebooks,
  saveLorebook,
  toSillyTavern,
  type Lorebook
} from '../lib/lorebookStore'

export function registerLorebooksIpc(): void {
  ipcMain.handle('lorebooks:list', (_e, workspace: string) => listLorebooks(workspace))
  ipcMain.handle('lorebooks:get', (_e, workspace: string, id: string) => getLorebook(workspace, id))
  ipcMain.handle('lorebooks:create', (_e, workspace: string, name: string) =>
    createLorebook(workspace, name)
  )
  ipcMain.handle('lorebooks:save', (_e, workspace: string, lorebook: Lorebook) =>
    saveLorebook(workspace, lorebook)
  )
  ipcMain.handle('lorebooks:delete', async (_e, workspace: string, id: string) => {
    await deleteLorebook(workspace, id)
    return true
  })

  ipcMain.handle('lorebooks:import', async (e, workspace: string) => {
    const result = await showOpenDialog(e, {
      title: 'Import SillyTavern lorebook',
      properties: ['openFile'],
      filters: [{ name: 'Lorebook JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    let json: unknown
    try {
      json = JSON.parse(await readFile(path, 'utf-8'))
    } catch {
      throw new Error('That file is not valid JSON.')
    }
    const fallback = basename(path).replace(/\.json$/i, '')
    return importLorebook(workspace, json, fallback)
  })

  ipcMain.handle('lorebooks:export', async (e, workspace: string, id: string) => {
    const lb = await getLorebook(workspace, id)
    if (!lb) return null
    const result = await showSaveDialog(e, {
      title: 'Export lorebook',
      defaultPath: `${lb.name}.json`,
      filters: [{ name: 'Lorebook JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(toSillyTavern(lb), null, 2), 'utf-8')
    return result.filePath
  })
}
