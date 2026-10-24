import { logApiCall } from './apiLogger'

// Client for the System One API (TypeSafe's Jev decision models), used via OpenRouter
// (`https://openrouter.ai/api/v1/systemone`, OpenRouter key). Not OpenAI-compatible: one POST with
// a text `state` and named, typed `questions`; the answers are structured values with
// probabilities, never generated text.

/** Yes/no question → probability (0–1) that the answer is yes. */
export interface NoulQuestion {
  type: 'noul'
  instructions: string
}

/** Pick-one question. `criteria` maps each option key to a description (or null). */
export interface ChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

/** Rubric question. `criteria` lists the levels, lowest first (max 10). */
export interface ScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | {
      type: 'choice'
      choice: string
      probabilities: Record<string, number>
      confidence: number
    }
  | {
      type: 'score'
      score: number
      legend: Record<string, string>
      probabilities: Record<string, number>
      confidence: number
    }

export interface DecisionResponse {
  model: string
  answers: Record<string, DecisionAnswer>
  usage?: { input_tokens: number; output_tokens: number }
}

export interface DecisionRequest {
  baseUrl: string
  apiKey: string
  model: string
  /** The text being judged (a string, or a JSON object/array of program state). */
  state: unknown
  questions: Record<string, DecisionQuestion>
  timeoutMs: number
  signal?: AbortSignal
}

export async function systemOne(
  workspace: string | null,
  req: DecisionRequest
): Promise<DecisionResponse> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/v1/systemone`
  const body = JSON.stringify({ model: req.model, state: req.state, questions: req.questions })
  const timeout = AbortSignal.timeout(req.timeoutMs)
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
  const start = Date.now()
  let status: number | null = null
  let text = ''
  let error: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${req.apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'StoryTavern/1.0'
      },
      body,
      signal
    })
    status = res.status
    text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    const json = JSON.parse(text) as DecisionResponse
    if (!json || typeof json.answers !== 'object') throw new Error('Malformed decision response')
    return json
  } catch (e) {
    const err =
      e instanceof Error && e.name === 'TimeoutError'
        ? new Error(`Decision model timed out after ${req.timeoutMs} ms`)
        : e instanceof Error
          ? e
          : new Error(String(e))
    error = err.message
    throw err
  } finally {
    if (workspace) {
      await logApiCall(workspace, {
        provider: 'openrouter',
        model: req.model,
        kind: 'decision',
        url,
        request_body: body,
        status,
        response_body: text || undefined,
        error,
        duration_ms: Date.now() - start
      }).catch(() => {})
    }
  }
}
