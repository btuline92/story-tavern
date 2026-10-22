import type { LLMProvider } from './types'
import type { ProviderId } from '../types'

const factory = (id: ProviderId, name: string): LLMProvider => ({
  id,
  name,
  testConnection: (apiKey?: string) => window.api.providers.test(id, null, apiKey)
})

export const providers: Record<ProviderId, LLMProvider> = {
  anthropic: factory('anthropic', 'Anthropic'),
  openai: factory('openai', 'OpenAI'),
  openrouter: factory('openrouter', 'OpenRouter'),
  deepseek: factory('deepseek', 'DeepSeek'),
  nanogpt: factory('nanogpt', 'NanoGPT'),
  featherless: factory('featherless', 'Featherless')
}
