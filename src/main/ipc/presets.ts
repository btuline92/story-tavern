import { ipcMain } from 'electron'
import { showOpenDialog, showSaveDialog } from '../lib/dialogs'
import { basename, extname } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  createPreset,
  deletePreset,
  exportToSillyTavern,
  getPreset,
  importPreset,
  listPresets,
  savePreset,
  type Preset
} from '../lib/presetStore'

export function registerPresetsIpc(): void {
  ipcMain.handle('presets:list', (_e, workspace: string) => listPresets(workspace))
  ipcMain.handle('presets:get', (_e, workspace: string, id: string) => getPreset(workspace, id))
  ipcMain.handle('presets:create', (_e, workspace: string, name: string) =>
    createPreset(workspace, name)
  )
  ipcMain.handle('presets:save', (_e, workspace: string, preset: Preset) =>
    savePreset(workspace, preset)
  )
  ipcMain.handle('presets:delete', async (_e, workspace: string, id: string) => {
    await deletePreset(workspace, id)
    return true
  })

  ipcMain.handle('presets:import', async (e, workspace: string) => {
    const result = await showOpenDialog(e, {
      title: 'Import preset (SillyTavern JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const text = await readFile(path, 'utf-8')
    const json = JSON.parse(text)
    const fallbackName = basename(path, extname(path))
    return importPreset(workspace, json, fallbackName)
  })

  ipcMain.handle('presets:export', async (e, workspace: string, id: string) => {
    const preset = await getPreset(workspace, id)
    if (!preset) return null
    const result = await showSaveDialog(e, {
      title: 'Export preset (SillyTavern JSON)',
      defaultPath: `${preset.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const st = exportToSillyTavern(preset)
    await writeFile(result.filePath, JSON.stringify(st, null, 2), 'utf-8')
    return result.filePath
  })
}
