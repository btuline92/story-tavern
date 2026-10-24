import { ipcMain } from 'electron'
import { getKey } from '../lib/safeStore'
import { systemOne } from '../lib/decisionClient'

export interface DecisionTestResult {
  ok: boolean
  error?: string
  /** Model version the API reported (e.g. 'jev-1.13.0') and the yes-probability it returned. */
  model?: string
  probability?: number
  durationMs?: number
}

export function registerDecisionIpc(): void {
  // Test a decision-model config (possibly unsaved) with one tiny yes/no question.
  ipcMain.handle(
    'decision:test',
    async (
      _e,
      opts: { model: string; baseUrl: string; timeoutMs: number },
      overrideKey?: string,
      workspace?: string
    ): Promise<DecisionTestResult> => {
      // Jev is reached through OpenRouter's System One API, billed to the OpenRouter key.
      const key = overrideKey ?? (await getKey('openrouter'))
      if (!key) return { ok: false, error: 'No OpenRouter API key saved (Settings → Providers).' }
      const start = Date.now()
      try {
        const res = await systemOne(workspace ?? null, {
          baseUrl: opts.baseUrl,
          apiKey: key,
          model: opts.model,
          timeoutMs: opts.timeoutMs,
          state: 'The knight drew her sword and charged the dragon.',
          questions: { action: { type: 'noul', instructions: 'Is this an action scene?' } }
        })
        const a = res.answers.action
        return {
          ok: true,
          model: res.model,
          probability: a?.type === 'noul' ? a.noul : undefined,
          durationMs: Date.now() - start
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
