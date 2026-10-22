import { ipcMain } from 'electron'
import { getKey } from '../lib/safeStore'
import { logApiCall } from '../lib/apiLogger'

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'deepseek' | 'nanogpt' | 'featherless'

export interface TestConnectionResult {
  ok: boolean
  error?: string
}

export interface ModelInfo {
  id: string
  description?: string
}

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openrouter/auto',
  deepseek: 'deepseek-chat',
  nanogpt: 'gpt-4o-mini',
  featherless: 'meta-llama/Meta-Llama-3.1-8B-Instruct'
}

const ANTHROPIC_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-7' },
  { id: 'claude-sonnet-4-6' },
  { id: 'claude-haiku-4-5-20251001' },
  { id: 'claude-3-5-sonnet-latest' },
  { id: 'claude-3-5-haiku-latest' }
]

async function callJson(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const res = await fetch(url, init)
  const body = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(body)
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, body, json }
}

function chatTestBody(model: string): string {
  return JSON.stringify({
    model,
    max_tokens: 4,
    messages: [{ role: 'user', content: 'hi' }]
  })
}

async function instrumented(
  workspace: string | null,
  provider: ProviderId,
  model: string | null,
  kind: 'test' | 'list-models',
  url: string,
  init: RequestInit & { body?: string }
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const start = Date.now()
  try {
    const r = await callJson(url, init)
    if (workspace) {
      await logApiCall(workspace, {
        provider,
        model,
        kind,
        url,
        request_body: typeof init.body === 'string' ? init.body : undefined,
        status: r.status,
        response_body: r.body,
        duration_ms: Date.now() - start
      })
    }
    return r
  } catch (e) {
    if (workspace) {
      await logApiCall(workspace, {
        provider,
        model,
        kind,
        url,
        request_body: typeof init.body === 'string' ? init.body : undefined,
        status: null,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - start
      })
    }
    throw e
  }
}

async function testAnthropic(
  workspace: string | null,
  key: string,
  model: string
): Promise<TestConnectionResult> {
  try {
    const r = await instrumented(
      workspace,
      'anthropic',
      model,
      'test',
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: chatTestBody(model)
      }
    )
    if (r.ok) return { ok: true }
    return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 300)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function testOpenAICompat(
  workspace: string | null,
  provider: ProviderId,
  url: string,
  key: string,
  model: string,
  extraHeaders: Record<string, string> = {}
): Promise<TestConnectionResult> {
  try {
    const r = await instrumented(workspace, provider, model, 'test', url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...extraHeaders
      },
      body: chatTestBody(model)
    })
    if (r.ok) return { ok: true }
    return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 300)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function listAnthropicModels(workspace: string | null, key: string): Promise<ModelInfo[]> {
  try {
    const url = 'https://api.anthropic.com/v1/models?limit=1000'
    const r = await instrumented(workspace, 'anthropic', null, 'list-models', url, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      }
    })
    if (!r.ok) return ANTHROPIC_FALLBACK_MODELS
    const data = (r.json as { data?: Array<{ id?: string; display_name?: string }> })?.data ?? []
    const list: ModelInfo[] = []
    for (const m of data) {
      if (typeof m.id === 'string') {
        const info: ModelInfo = { id: m.id }
        if (typeof m.display_name === 'string') info.description = m.display_name
        list.push(info)
      }
    }
    return list.length > 0 ? list : ANTHROPIC_FALLBACK_MODELS
  } catch {
    return ANTHROPIC_FALLBACK_MODELS
  }
}

async function listOpenAIStyleModels(
  workspace: string | null,
  provider: ProviderId,
  url: string,
  key: string
): Promise<ModelInfo[]> {
  const r = await instrumented(workspace, provider, null, 'list-models', url, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}` }
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 200)}`)
  const data = (r.json as { data?: Array<{ id?: string }> })?.data ?? []
  const list: ModelInfo[] = []
  for (const m of data) {
    if (typeof m.id === 'string') list.push({ id: m.id })
  }
  return list
}

async function listOpenRouterModels(workspace: string | null): Promise<ModelInfo[]> {
  const url = 'https://openrouter.ai/api/v1/models'
  const r = await instrumented(workspace, 'openrouter', null, 'list-models', url, { method: 'GET' })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 200)}`)
  const data = (r.json as { data?: Array<{ id?: string; name?: string }> })?.data ?? []
  const list: ModelInfo[] = []
  for (const m of data) {
    if (typeof m.id === 'string') {
      const info: ModelInfo = { id: m.id }
      if (typeof m.name === 'string') info.description = m.name
      list.push(info)
    }
  }
  return list
}

async function listModels(
  workspace: string | null,
  provider: ProviderId,
  key: string | null
): Promise<ModelInfo[]> {
  switch (provider) {
    case 'anthropic':
      if (!key) return ANTHROPIC_FALLBACK_MODELS
      return listAnthropicModels(workspace, key)
    case 'openai':
      if (!key) throw new Error('OpenAI requires an API key to list models')
      return listOpenAIStyleModels(workspace, 'openai', 'https://api.openai.com/v1/models', key)
    case 'openrouter':
      return listOpenRouterModels(workspace)
    case 'deepseek':
      if (!key) throw new Error('DeepSeek requires an API key to list models')
      return listOpenAIStyleModels(workspace, 'deepseek', 'https://api.deepseek.com/v1/models', key)
    case 'nanogpt':
      if (!key) throw new Error('NanoGPT requires an API key to list models')
      return listOpenAIStyleModels(workspace, 'nanogpt', 'https://nano-gpt.com/api/v1/models', key)
    case 'featherless':
      if (!key) throw new Error('Featherless requires an API key to list models')
      return listOpenAIStyleModels(
        workspace,
        'featherless',
        'https://api.featherless.ai/v1/models',
        key
      )
    default:
      throw new Error(`Unknown provider: ${String(provider)}`)
  }
}

export function defaultModelFor(provider: ProviderId): string {
  return DEFAULT_MODELS[provider]
}

export function registerProvidersIpc(): void {
  ipcMain.handle(
    'providers:test',
    async (
      _e,
      provider: ProviderId,
      model: string | null,
      overrideKey?: string,
      workspace?: string
    ): Promise<TestConnectionResult> => {
      const key = overrideKey ?? (await getKey(provider))
      if (!key) return { ok: false, error: 'No API key set for this provider' }
      const m = model || DEFAULT_MODELS[provider]
      const ws = workspace ?? null
      switch (provider) {
        case 'anthropic':
          return testAnthropic(ws, key, m)
        case 'openai':
          return testOpenAICompat(
            ws,
            'openai',
            'https://api.openai.com/v1/chat/completions',
            key,
            m
          )
        case 'openrouter':
          return testOpenAICompat(
            ws,
            'openrouter',
            'https://openrouter.ai/api/v1/chat/completions',
            key,
            m,
            {
              'HTTP-Referer': 'https://story-tavern.local',
              'X-Title': 'Story Tavern'
            }
          )
        case 'deepseek':
          return testOpenAICompat(
            ws,
            'deepseek',
            'https://api.deepseek.com/v1/chat/completions',
            key,
            m
          )
        case 'nanogpt':
          return testOpenAICompat(
            ws,
            'nanogpt',
            'https://nano-gpt.com/api/v1/chat/completions',
            key,
            m
          )
        case 'featherless':
          return testOpenAICompat(
            ws,
            'featherless',
            'https://api.featherless.ai/v1/chat/completions',
            key,
            m
          )
        default:
          return { ok: false, error: `Unknown provider: ${String(provider)}` }
      }
    }
  )

  ipcMain.handle(
    'providers:list-models',
    async (
      _e,
      provider: ProviderId,
      overrideKey?: string,
      workspace?: string
    ): Promise<ModelInfo[]> => {
      const key = overrideKey ?? (await getKey(provider))
      return listModels(workspace ?? null, provider, key)
    }
  )
}
