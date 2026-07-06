import { ipcMain } from 'electron'
import {
  createPlugin,
  deletePlugin,
  getPlugin,
  listPlugins,
  savePlugin,
  type Plugin
} from '../lib/pluginStore'

export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:list', (_e, workspace: string) => listPlugins(workspace))
  ipcMain.handle('plugins:get', (_e, workspace: string, id: string) => getPlugin(workspace, id))
  ipcMain.handle('plugins:create', (_e, workspace: string, name: string) =>
    createPlugin(workspace, name)
  )
  ipcMain.handle('plugins:save', (_e, workspace: string, plugin: Plugin) =>
    savePlugin(workspace, plugin)
  )
  ipcMain.handle('plugins:delete', async (_e, workspace: string, id: string) => {
    await deletePlugin(workspace, id)
    return true
  })
}
