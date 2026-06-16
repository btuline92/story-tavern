import { ipcMain } from 'electron'
import { fetchObjectInfo, pingComfy, type ObjectInfoLists } from '../lib/comfyClient'
import { deleteWorkflow, listWorkflows, readWorkflow, saveWorkflow } from '../lib/comfyWorkflows'

export interface ComfyTestResult {
  ok: boolean
  error?: string
}

export function registerComfyIpc(): void {
  ipcMain.handle('comfy:test', async (_e, url: string): Promise<ComfyTestResult> => {
    try {
      await pingComfy(url)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'comfy:object-info',
    async (_e, url: string): Promise<ObjectInfoLists | { error: string }> => {
      try {
        return await fetchObjectInfo(url)
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('comfy:workflows:list', async (_e, workspace: string): Promise<string[]> => {
    return listWorkflows(workspace)
  })

  ipcMain.handle(
    'comfy:workflows:get',
    async (_e, workspace: string, name: string): Promise<string> => {
      return readWorkflow(workspace, name)
    }
  )

  ipcMain.handle(
    'comfy:workflows:save',
    async (_e, workspace: string, name: string, json: string): Promise<string[]> => {
      return saveWorkflow(workspace, name, json)
    }
  )

  ipcMain.handle(
    'comfy:workflows:delete',
    async (_e, workspace: string, name: string): Promise<string[]> => {
      return deleteWorkflow(workspace, name)
    }
  )
}
