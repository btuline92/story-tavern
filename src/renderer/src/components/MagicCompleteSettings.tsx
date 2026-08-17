import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'

/**
 * Default Magic Complete beat-planning prompt, mirrored from the main process
 * (workspace.ts `DEFAULT_MAGIC_BEAT_PROMPT`) so "Reset to default" restores it instantly.
 * Keep these two copies in sync.
 */
const DEFAULT_MAGIC_BEAT_PROMPT = `You are a story-planning assistant. You break a chapter outline into an ordered list of concrete story beats.
A beat is a single step of the chapter — one action, turn, revelation, or emotional shift — that would be written as roughly a few paragraphs of prose.

Rules:
- Order the beats as they occur in the chapter.
- Together the beats must cover the entire outline. Do not invent a different plot; you may add small connective moments.
- Let the outline decide how many beats there are: if it is a numbered or bulleted list, produce one beat per item; otherwise break it into as many beats as its distinct events require. Do not pad it out or compress it.
- Each beat is one or two sentences of plain description of what happens, not prose.
- Respond with ONLY a JSON array of strings and nothing else — no prose, no keys, no markdown fences.
- NSFW content is allowed if the outline calls for it.
Example: ["Beat one...", "Beat two...", "Beat three..."]`

export function MagicCompleteSettings(): React.JSX.Element | null {
  const workspace = useWorkspace((s) => s.path)!
  const settings = useSettings((s) => s.settings)
  const setMagicAutoStart = useSettings((s) => s.setMagicAutoStart)
  const setMagicBeatPrompt = useSettings((s) => s.setMagicBeatPrompt)

  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  // Seed the prompt draft once from the loaded setting (then it's user-owned until Save/Reset).
  useEffect(() => {
    if (!initialized.current && settings) {
      initialized.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(settings.magicBeatPrompt)
    }
  }, [settings])

  if (!settings) return null

  const dirty = draft !== settings.magicBeatPrompt
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await setMagicBeatPrompt(workspace, draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="st-card p-4 mb-6">
      <div className="font-medium text-ink-900 mb-3">Magic Complete</div>

      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={settings.magicAutoStart}
          onChange={(e) => setMagicAutoStart(workspace, e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-accent-500"
        />
        <div>
          <div className="text-sm font-medium text-ink-900">Auto-start</div>
          <div className="text-sm text-ink-700 mt-1">
            On: Magic Complete plans the chapter&apos;s beats and writes them straight through. Off: it
            plans the beats and stops at 0/N so you can review, edit, and reorder them first — then press
            Resume to write.
          </div>
        </div>
      </label>

      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-medium text-ink-900">Beat-planning prompt</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-700">{dirty ? '• unsaved' : 'saved'}</span>
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_MAGIC_BEAT_PROMPT)}
            className="st-btn st-btn-sm st-btn-default"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="st-btn st-btn-sm st-btn-primary"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={draft}
        rows={12}
        onChange={(e) => setDraft(e.target.value)}
        className="st-textarea w-full font-mono text-xs"
      />
      <div className="text-xs text-ink-700 mt-1">
        The system prompt that turns a chapter outline into beats. It must tell the model to return a
        JSON array of strings. Leave it blank and save to restore the default.
      </div>
    </div>
  )
}
