import { useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'

// Common OpenRouter provider names, offered as suggestions. Any name can be typed —
// OpenRouter matches against its provider list.
const KNOWN_PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Google',
  'Google AI Studio',
  'Amazon Bedrock',
  'Azure',
  'DeepInfra',
  'Together',
  'Fireworks',
  'Mistral',
  'DeepSeek',
  'Groq',
  'Cerebras',
  'SambaNova',
  'Novita',
  'Lambda',
  'Hyperbolic',
  'Lepton',
  'Perplexity',
  'xAI',
  'Cohere',
  'Nebius'
]

export function OpenRouterRouting(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { settings, setOpenRouter } = useSettings()
  const [input, setInput] = useState('')

  if (!settings) return <></>
  const { order, allowFallbacks } = settings.openrouter

  const add = (raw: string): void => {
    const name = raw.trim()
    if (!name) return
    if (!order.some((o) => o.toLowerCase() === name.toLowerCase())) {
      void setOpenRouter(workspace, { order: [...order, name] })
    }
    setInput('')
  }
  const remove = (name: string): void => {
    void setOpenRouter(workspace, { order: order.filter((o) => o !== name) })
  }
  const move = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    void setOpenRouter(workspace, { order: next })
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4 mb-6">
      <div className="font-medium text-ink-900 mb-1">OpenRouter routing</div>
      <div className="text-xs text-ink-700 mb-4">
        Applies whenever OpenRouter is used — for both story generation and image tagging.
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowFallbacks}
          onChange={(e) => void setOpenRouter(workspace, { allowFallbacks: e.target.checked })}
          className="h-4 w-4 accent-accent-500"
        />
        <span className="text-sm text-ink-900">Allow fallbacks to other providers</span>
      </label>
      <div className="text-xs text-ink-700 mt-1 mb-4 ml-6">
        When off, OpenRouter uses only the providers below and errors if none are available.
      </div>

      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-700 mb-1">
        Preferred providers (highest priority first)
      </label>
      {order.length === 0 ? (
        <div className="text-xs text-ink-700 italic mb-2">
          None selected — OpenRouter chooses the provider automatically.
        </div>
      ) : (
        <ul className="mb-2 space-y-1">
          {order.map((name, idx) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-md border border-ink-200 px-2 py-1"
            >
              <span className="w-5 text-xs text-ink-700 tabular-nums">{idx + 1}.</span>
              <span className="flex-1 text-sm text-ink-900">{name}</span>
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                title="Move up"
                className="px-1 text-ink-700 hover:text-ink-900 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === order.length - 1}
                title="Move down"
                className="px-1 text-ink-700 hover:text-ink-900 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(name)}
                title="Remove"
                className="px-1 text-ink-700 hover:text-red-700"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          list="openrouter-providers"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(input)
            }
          }}
          placeholder="Add a provider (e.g. OpenAI)"
          className="flex-1 rounded-md border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <datalist id="openrouter-providers">
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => add(input)}
          disabled={!input.trim()}
          className="rounded-md border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
