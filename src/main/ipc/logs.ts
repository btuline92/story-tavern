import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { getLogEntry, listRecentLogs, logsDirPath } from '../lib/apiLogger'

export function registerLogsIpc(): void {
  ipcMain.handle('logs:list-recent', async (_e, workspace: string, limit?: number) => {
    return listRecentLogs(workspace, limit ?? 200)
  })

  ipcMain.handle('logs:get', async (_e, workspace: string, id: string) => {
    return getLogEntry(workspace, id)
  })

  ipcMain.handle('logs:reveal', async (_e, workspace: string) => {
    const dir = logsDirPath(workspace)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return true
  })
}
