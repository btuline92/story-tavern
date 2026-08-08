import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import { useTheme, THEMES } from '../stores/theme'
import { askConfirm } from '../stores/dialog'
import type { ProviderId } from '../types'
import { ModelSelect } from './ModelSelect'
import { ModelPresetsPanel } from './ModelPresets'
import { OpenRouterRouting } from './OpenRouterRouting'

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'nanogpt', name: 'NanoGPT' }
]

interface ProviderRowProps {
  provider: ProviderId
  name: string
  workspace: string
}

function ProviderRow({ provider, name, workspace }: ProviderRowProps): React.JSX.Element {
  const { hasKey, saveKey, deleteKey, settings, setModel } = useSettings()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const onSave = async (): Promise<void> => {
    if (!input.trim()) return
    setSaving(true)
    try {
      await saveKey(provider, input.trim())
      setInput('')
    } finally {
      setSaving(false)
    }
  }

  const onTest = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      const overrideKey = input.trim() || undefined
      const model = settings?.models[provider] ?? null
      const r = await window.api.providers.test(provider, model, overrideKey, workspace)
      setResult(r)
    } finally {
      setTesting(false)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (await askConfirm(`Remove the saved ${name} API key from this machine?`)) {
      await deleteKey(provider)
      setResult(null)
    }
  }

  return (
    <div className="st-card p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-medium text-ink-900">{name}</div>
          <div className="text-xs text-ink-700">
            {hasKey[provider] ? 'Key saved on this machine' : 'No key saved'}
          </div>
        </div>
        {hasKey[provider] && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-ink-700 hover:text-ink-900 underline"
          >
            Remove key
          </button>
        )}
      </div>
      <div className="flex gap-2 mb-3">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasKey[provider] ? '••••••••  (paste a new key to replace)' : 'API key'}
          className="st-input flex-1"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !input.trim()}
          className="st-btn st-btn-primary"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onTest}
          disabled={testing || (!hasKey[provider] && !input.trim())}
          className="st-btn st-btn-default"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-700 mb-1">Model</label>
        <ModelSelect
          provider={provider}
          value={settings?.models[provider] ?? ''}
          hasKey={hasKey[provider]}
          onChange={(model) => setModel(workspace, provider, model)}
        />
      </div>
      {result && (
        <div
          className={`mt-3 text-sm ${result.ok ? 'text-success' : 'text-danger'} whitespace-pre-wrap`}
        >
          {result.ok ? '✓ Connection successful' : `✗ ${result.error}`}
        </div>
      )}
    </div>
  )
}

export function Settings(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const switchWorkspace = useWorkspace((s) => s.switchWorkspace)
  const { settings, load, loaded } = useSettings()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!loaded) load(workspace)
  }, [workspace, load, loaded])

  if (!loaded || !settings) return <div className="p-8 text-ink-700">Loading settings…</div>

  return (
    <div className="h-full overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-ink-900 mb-6">Settings</h2>

      <div className="st-card p-4 mb-6">
        <div className="font-medium text-ink-900 mb-1">Theme</div>
        <div className="text-sm text-ink-700 mb-3">Applies everywhere, saved on this machine.</div>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number]['id'])}
          className="st-select"
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="st-card p-4 mb-6">
        <div className="font-medium text-ink-900 mb-1">Workspace</div>
        <div className="text-sm text-ink-700 mb-3 break-all">{workspace}</div>
        <button
          type="button"
          onClick={() => switchWorkspace()}
          className="st-btn st-btn-sm st-btn-default"
        >
          Switch workspace…
        </button>
      </div>

      <ModelPresetsPanel />

      <div className="font-medium text-ink-900 mb-2">Providers &amp; API keys</div>
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} provider={p.id} name={p.name} workspace={workspace} />
      ))}

      <OpenRouterRouting />
    </div>
  )
}
