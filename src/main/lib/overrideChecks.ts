import { getKey } from './safeStore'
import { systemOne, type DecisionQuestion } from './decisionClient'
import {
  resolveDecisionModel,
  resolveOverrideModel,
  type OverrideQuestion,
  type ResolvedModel,
  type WorkspaceSettings
} from '../ipc/workspace'

// Filter-avoidance routing (Overrides tab). The decision model (Jev, via OpenRouter) answers yes/no
// questions about the outgoing prompt and the main model's reply; a "yes" at or above the preset's
// threshold switches that generation to the override model.

export type CheckKind = 'prompt' | 'response'

export interface CheckOutcome {
  triggered: boolean
  /** The question that triggered (highest probability among those over threshold). */
  question?: string
  probability?: number
  /** Set when the decision call failed; the caller then keeps the main model. */
  error?: string
}

/** Everything needed to route a generation, or null when overrides are inactive for this preset. */
export interface OverrideRouting {
  override: ResolvedModel
  overrideKey: string
  promptChecks: OverrideQuestion[]
  responseChecks: OverrideQuestion[]
  run: (kind: CheckKind, text: string, signal?: AbortSignal) => Promise<CheckOutcome>
}

export async function getOverrideRouting(
  workspace: string,
  settings: WorkspaceSettings
): Promise<OverrideRouting | null> {
  const decision = resolveDecisionModel(settings)
  const override = resolveOverrideModel(settings)
  if (!decision || !override) return null
  const cfg = settings.overrides
  const promptChecks = cfg.promptChecks.filter((q) => q.enabled && q.text.trim())
  const responseChecks = cfg.responseChecks.filter((q) => q.enabled && q.text.trim())
  if (promptChecks.length === 0 && responseChecks.length === 0) return null
  const decisionKey = await getKey('openrouter')
  const overrideKey = await getKey(override.provider)
  // Without either key there's nothing useful to do; generation proceeds on the main model.
  if (!decisionKey || !overrideKey) return null

  const run = async (
    kind: CheckKind,
    text: string,
    signal?: AbortSignal
  ): Promise<CheckOutcome> => {
    const questions = kind === 'prompt' ? promptChecks : responseChecks
    if (questions.length === 0 || !text.trim()) return { triggered: false }
    const named: Record<string, DecisionQuestion> = {}
    questions.forEach((q, i) => {
      named[`q${i}`] = { type: 'noul', instructions: q.text }
    })
    try {
      const res = await systemOne(workspace, {
        baseUrl: decision.baseUrl,
        apiKey: decisionKey,
        model: decision.model,
        timeoutMs: decision.timeoutMs,
        state: text,
        questions: named,
        signal
      })
      let best: CheckOutcome = { triggered: false }
      questions.forEach((q, i) => {
        const a = res.answers[`q${i}`]
        if (a?.type !== 'noul') return
        if (a.noul >= decision.threshold && a.noul > (best.probability ?? -1)) {
          best = { triggered: true, question: q.text, probability: a.noul }
        }
      })
      return best
    } catch (e) {
      return { triggered: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { override, overrideKey, promptChecks, responseChecks, run }
}

/** Short human-readable note for the editor, e.g. why the override model was used. */
export function describeOutcome(kind: CheckKind, o: CheckOutcome, overrideModel: string): string {
  if (o.error)
    return `${kind === 'prompt' ? 'Prompt' : 'Response'} check failed (${o.error}); kept the main model.`
  const p = o.probability != null ? ` (${Math.round(o.probability * 100)}%)` : ''
  return kind === 'prompt'
    ? `Override model ${overrideModel} used — prompt check: "${o.question}"${p}`
    : `Main reply flagged — response check: "${o.question}"${p}. Regenerated with ${overrideModel}.`
}
