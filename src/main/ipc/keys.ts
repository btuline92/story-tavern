import { ipcMain } from 'electron'
import { deleteKey, getKey, setKey } from '../lib/safeStore'

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'deepseek' | 'nanogpt'

const ALL_PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'nanogpt']

export function registerKeysIpc(): void {
  ipcMain.handle('keys:get', async (_e, provider: ProviderId) => {
    return getKey(provider)
  })
  ipcMain.handle('keys:set', async (_e, provider: ProviderId, key: string) => {
    await setKey(provider, key)
    return true
  })
  ipcMain.handle('keys:delete', async (_e, provider: ProviderId) => {
    await deleteKey(provider)
    return true
  })
  ipcMain.handle('keys:has', async () => {
    const out: Record<ProviderId, boolean> = {
      anthropic: false,
      openai: false,
      openrouter: false,
      deepseek: false,
      nanogpt: false
    }
    await Promise.all(
      ALL_PROVIDERS.map(async (p) => {
        out[p] = !!(await getKey(p))
      })
    )
    return out
  })
}
