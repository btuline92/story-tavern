import type { ProviderId } from '../types'

export interface LLMProvider {
  id: ProviderId
  name: string
  testConnection: (apiKey?: string) => Promise<{ ok: boolean; error?: string }>
}
