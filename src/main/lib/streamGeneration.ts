import type { GenerationSettings, ReasoningLevel } from '../ipc/workspace'
import type { ProviderId } from '../ipc/providers'
import { toAnthropic, toOpenAI, type PromptEntry } from './promptAssembly'

// Map the unified reasoning_level to an Anthropic thinking budget. These numbers
// match OpenRouter's mapping for Claude models when its `reasoning.effort` is used.
const ANTHROPIC_THINKING_BUDGET: Record<Exclude<ReasoningLevel, 'off'>, number> = {
  low: 2048,
  medium: 8192,
  high: 24576
}

export interface StreamRequest {
  provider: ProviderId
  model: string
  apiKey: string
  generation: GenerationSettings
  entries: PromptEntry[]
}

export interface StreamHandlers {
  onDelta: (text: string) => void
  onReasoning: (text: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

export interface StreamMetrics {
  status: number
  url: string
  requestBody: string
  fullText: string
  reasoningText: string
  chunkCount: number
  durationMs: number
  error: string | null
}

// --- SSE parsing ---

interface SseEvent {
  event?: string
  data: string
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const lines = block.split('\n')
        let evt: string | undefined
        const dataLines: string[] = []
        for (const line of lines) {
          if (line.startsWith('event:')) evt = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        }
        if (dataLines.length > 0) yield { event: evt, data: dataLines.join('\n') }
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}

// --- Per-provider request shaping ---

function isOpenAIReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|gpt-o)/i.test(model)
}

function anthropicRequest(req: StreamRequest): { url: string; init: RequestInit; body: string } {
  const { system, messages } = toAnthropic(req.entries)
  const level = req.generation.reasoning_level
  const thinkingOn = level !== 'off'
  const budget = thinkingOn ? ANTHROPIC_THINKING_BUDGET[level] : 0
  // Anthropic requires max_tokens > thinking budget. Auto-bump locally if too low so the
  // request doesn't 400; doesn't mutate the user's saved setting.
  const maxTokens = thinkingOn
    ? Math.max(req.generation.max_tokens, budget + 4096)
    : req.generation.max_tokens

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: maxTokens,
    system,
    messages,
    stream: true
  }
  if (thinkingOn) {
    body.thinking = { type: 'enabled', budget_tokens: budget }
    body.temperature = 1
  } else {
    body.temperature = req.generation.temperature
    body.top_p = req.generation.top_p
    if (req.generation.top_k != null) body.top_k = req.generation.top_k
  }
  if (req.generation.stop_sequences.length > 0) body.stop_sequences = req.generation.stop_sequences

  const bodyStr = JSON.stringify(body)
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: bodyStr
    },
    body: bodyStr
  }
}

function openAICompatRequest(
  url: string,
  req: StreamRequest,
  options: { provider: 'openai' | 'openrouter' | 'deepseek'; extraHeaders?: Record<string, string> }
): { url: string; init: RequestInit; body: string } {
  const messages = toOpenAI(req.entries)
  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.generation.max_tokens,
    stream: true
  }
  const reasoningOn = req.generation.reasoning_level !== 'off'
  const isOpenAIReasoning = options.provider === 'openai' && isOpenAIReasoningModel(req.model)

  // Sampling params: reasoning-only models (OpenAI o-series) reject temperature/top_p, so omit them.
  if (!isOpenAIReasoning) {
    body.temperature = req.generation.temperature
    body.top_p = req.generation.top_p
    if (req.generation.frequency_penalty !== 0)
      body.frequency_penalty = req.generation.frequency_penalty
    if (req.generation.presence_penalty !== 0)
      body.presence_penalty = req.generation.presence_penalty
  }

  // Reasoning param shape varies by provider.
  if (reasoningOn) {
    if (options.provider === 'openai' && isOpenAIReasoning) {
      // OpenAI o-series uses reasoning_effort directly.
      body.reasoning_effort = req.generation.reasoning_level
    } else if (options.provider === 'openrouter') {
      // OpenRouter's unified abstraction: it translates `reasoning.effort` to the
      // underlying provider's mechanism (Anthropic thinking, OpenAI effort, R1, etc.).
      body.reasoning = { effort: req.generation.reasoning_level }
    }
    // DeepSeek direct: no API param — user picks a reasoning-capable model id
    // (e.g. deepseek-reasoner). The streamed `reasoning_content` will still be captured.
  }

  if (req.generation.seed != null) body.seed = req.generation.seed
  if (req.generation.stop_sequences.length > 0) body.stop = req.generation.stop_sequences
  if (req.generation.top_k != null) body.top_k = req.generation.top_k
  if (req.generation.min_p != null) body.min_p = req.generation.min_p

  const bodyStr = JSON.stringify(body)
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${req.apiKey}`,
        ...(options.extraHeaders ?? {})
      },
      body: bodyStr
    },
    body: bodyStr
  }
}

// --- Stream consumption ---

interface ConsumeResult {
  fullText: string
  reasoningText: string
  chunkCount: number
}

async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onReasoning: (text: string) => void
): Promise<ConsumeResult> {
  let fullText = ''
  let reasoningText = ''
  let chunkCount = 0
  for await (const evt of parseSse(body, signal)) {
    if (evt.data === '[DONE]') break
    try {
      const obj = JSON.parse(evt.data) as {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
      }
      if (obj.type === 'content_block_delta') {
        if (obj.delta?.type === 'text_delta') {
          const text = obj.delta.text ?? ''
          if (text) {
            fullText += text
            chunkCount += 1
            onDelta(text)
          }
        } else if (obj.delta?.type === 'thinking_delta') {
          const text = obj.delta.thinking ?? ''
          if (text) {
            reasoningText += text
            onReasoning(text)
          }
        }
      }
    } catch {
      /* skip malformed event */
    }
  }
  return { fullText, reasoningText, chunkCount }
}

async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onReasoning: (text: string) => void
): Promise<ConsumeResult> {
  let fullText = ''
  let reasoningText = ''
  let chunkCount = 0
  for await (const evt of parseSse(body, signal)) {
    if (evt.data === '[DONE]') break
    try {
      const obj = JSON.parse(evt.data) as {
        choices?: Array<{
          delta?: {
            content?: string
            // DeepSeek reasoner emits thinking on `reasoning_content`.
            reasoning_content?: string
            // OpenRouter emits thinking on `reasoning`.
            reasoning?: string
          }
        }>
      }
      const delta = obj.choices?.[0]?.delta
      const text = delta?.content ?? ''
      if (text) {
        fullText += text
        chunkCount += 1
        onDelta(text)
      }
      const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? ''
      if (reasoning) {
        reasoningText += reasoning
        onReasoning(reasoning)
      }
    } catch {
      /* skip malformed event */
    }
  }
  return { fullText, reasoningText, chunkCount }
}

// --- Public entrypoint ---

export async function streamContinue(
  req: StreamRequest,
  signal: AbortSignal,
  handlers: StreamHandlers
): Promise<StreamMetrics> {
  let prepared: { url: string; init: RequestInit; body: string }
  let consume: (
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    onDelta: (text: string) => void,
    onReasoning: (text: string) => void
  ) => Promise<ConsumeResult>

  switch (req.provider) {
    case 'anthropic':
      prepared = anthropicRequest(req)
      consume = consumeAnthropicStream
      break
    case 'openai':
      prepared = openAICompatRequest('https://api.openai.com/v1/chat/completions', req, {
        provider: 'openai'
      })
      consume = consumeOpenAIStream
      break
    case 'openrouter':
      prepared = openAICompatRequest('https://openrouter.ai/api/v1/chat/completions', req, {
        provider: 'openrouter',
        extraHeaders: {
          'HTTP-Referer': 'https://story-tavern.local',
          'X-Title': 'Story Tavern'
        }
      })
      consume = consumeOpenAIStream
      break
    case 'deepseek':
      prepared = openAICompatRequest('https://api.deepseek.com/v1/chat/completions', req, {
        provider: 'deepseek'
      })
      consume = consumeOpenAIStream
      break
    default:
      handlers.onError(`Unknown provider: ${String(req.provider)}`)
      return {
        status: 0,
        url: '',
        requestBody: '',
        fullText: '',
        reasoningText: '',
        chunkCount: 0,
        durationMs: 0,
        error: `Unknown provider: ${String(req.provider)}`
      }
  }

  const init: RequestInit = { ...prepared.init, signal }
  const start = Date.now()
  let res: Response
  try {
    res = await fetch(prepared.url, init)
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    handlers.onError(err)
    return {
      status: 0,
      url: prepared.url,
      requestBody: prepared.body,
      fullText: '',
      reasoningText: '',
      chunkCount: 0,
      durationMs: Date.now() - start,
      error: err
    }
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    const err = `HTTP ${res.status}: ${text.slice(0, 500)}`
    handlers.onError(err)
    return {
      status: res.status,
      url: prepared.url,
      requestBody: prepared.body,
      fullText: '',
      reasoningText: '',
      chunkCount: 0,
      durationMs: Date.now() - start,
      error: err
    }
  }

  try {
    const { fullText, reasoningText, chunkCount } = await consume(
      res.body,
      signal,
      handlers.onDelta,
      handlers.onReasoning
    )
    handlers.onDone(fullText)
    return {
      status: res.status,
      url: prepared.url,
      requestBody: prepared.body,
      fullText,
      reasoningText,
      chunkCount,
      durationMs: Date.now() - start,
      error: null
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    if (signal.aborted) {
      return {
        status: res.status,
        url: prepared.url,
        requestBody: prepared.body,
        fullText: '',
        reasoningText: '',
        chunkCount: 0,
        durationMs: Date.now() - start,
        error: 'aborted'
      }
    }
    handlers.onError(err)
    return {
      status: res.status,
      url: prepared.url,
      requestBody: prepared.body,
      fullText: '',
      reasoningText: '',
      chunkCount: 0,
      durationMs: Date.now() - start,
      error: err
    }
  }
}
