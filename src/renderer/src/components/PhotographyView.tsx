import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../stores/settings'
import { useCharacters } from '../stores/characters'
import { useWorkspace } from '../stores/workspace'
import { usePhotography } from '../stores/photography'
import type { ImagePhase, PhotographResult } from '../types'
import { CharacterPicker } from './CharacterPicker'
import { Lightbox } from './Lightbox'

function newGenId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function PhotographyView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const settings = useSettings((s) => s.settings)
  const { characters, load } = useCharacters()
  const image = settings?.image ?? null

  // Form state lives in a store so edits survive navigating to another tab and back.
  const {
    mode,
    selectedIds,
    sceneText,
    directPrompt,
    prefixName,
    tagPromptName,
    tagInstructionOverride,
    systemOverride,
    setMode,
    setSelectedIds,
    setSceneText,
    setDirectPrompt,
    setPrefixName,
    setTagPromptName,
    setTagInstructionOverride,
    setSystemOverride
  } = usePhotography()

  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<ImagePhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PhotographResult | null>(null)
  const [copied, setCopied] = useState(false)

  const [saveTargetId, setSaveTargetId] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null)
  const genIdRef = useRef<string | null>(null)

  useEffect(() => {
    load(workspace)
  }, [workspace, load])

  if (!image) {
    return <div className="p-8 text-sm text-ink-700">Loading settings…</div>
  }

  const activeTag =
    image.tagPrompts.find((p) => p.name === (tagPromptName || image.activeTagPrompt)) ??
    image.tagPrompts[0]
  const savedTagText = activeTag?.text ?? ''
  const tagInstructionValue = tagInstructionOverride ?? savedTagText

  const activeSystem =
    image.systemPrompts.find((p) => p.name === image.activeSystemPrompt) ?? image.systemPrompts[0]
  const savedSystemText = activeSystem?.text ?? ''
  const systemPromptValue = systemOverride ?? savedSystemText

  const toggleChar = (id: string): void =>
    setSelectedIds(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    )

  const canGenerate =
    image.enabled &&
    !loading &&
    (mode === 'scene' ? sceneText.trim().length > 0 : directPrompt.trim().length > 0)

  const generate = async (): Promise<void> => {
    const gid = newGenId()
    genIdRef.current = gid
    setLoading(true)
    setError(null)
    setResult(null)
    setSavedMsg(null)
    setPhase('tagging')
    const off = window.api.image.onProgress((id, ph) => {
      if (id === gid) setPhase(ph)
    })
    try {
      const res = await window.api.image.photograph(gid, workspace, {
        mode,
        characterIds: selectedIds,
        sceneText,
        directPrompt,
        systemPrompt: systemPromptValue,
        tagInstruction: tagInstructionValue,
        prefixName: prefixName || image.activePromptPrefix
      })
      if ('error' in res) {
        if (res.error !== 'aborted') setError(res.error)
      } else {
        setResult(res)
        setSaveTargetId(selectedIds[0] ?? characters[0]?.id ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
      setLoading(false)
      setPhase(null)
      genIdRef.current = null
    }
  }

  const cancel = (): void => {
    if (genIdRef.current) window.api.image.cancel(genIdRef.current)
  }

  const copyPositive = (): void => {
    if (!result?.positive) return
    navigator.clipboard
      .writeText(result.positive)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  const saveToGallery = async (): Promise<void> => {
    if (!result || !saveTargetId) return
    setSaving(true)
    try {
      const res = await window.api.gallery.save(
        workspace,
        saveTargetId,
        result.dataUrl,
        result.positive
      )
      if (res && 'error' in res) {
        setError(res.error)
      } else {
        const name = characters.find((c) => c.id === saveTargetId)?.name ?? 'character'
        setSavedMsg(`Saved to ${name}'s gallery ✓`)
        setTimeout(() => setSavedMsg(null), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-6 text-2xl font-semibold text-ink-900">Photography</h2>

        {!image.enabled && (
          <div className="mb-6 rounded-md border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-700">
            Image generation is disabled. Enable it and configure ComfyUI in{' '}
            <span className="font-medium">Settings → Images</span> first.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---- Controls ---- */}
          <div className="st-card p-4">
            {/* Mode toggle */}
            <div className="mb-4 inline-flex rounded-md border border-ink-200 p-0.5">
              {(['scene', 'prompt'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded px-3 py-1.5 text-sm ${
                    mode === m ? 'bg-ink-100 text-ink-900' : 'text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  {m === 'scene' ? 'Scene (tagged)' : 'Direct prompt'}
                </button>
              ))}
            </div>

            {/* Characters */}
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
              Characters {mode === 'scene' ? '(appearance reference)' : '(for saving)'}
            </label>
            <div className="mb-4">
              <CharacterPicker
                characters={characters}
                selectedIds={selectedIds}
                onToggle={toggleChar}
                heightClass="max-h-40"
              />
            </div>

            {/* Prefix pair (positive prefix + silent negative) */}
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
              Prompt prefix set
            </label>
            <select
              value={prefixName || image.activePromptPrefix}
              onChange={(e) => setPrefixName(e.target.value)}
              className="st-select mb-4 w-full"
            >
              {image.promptPrefixes.map((p, i) => (
                <option key={i} value={p.name}>
                  {p.name || '(unnamed)'}
                </option>
              ))}
            </select>

            {mode === 'scene' ? (
              <>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
                  Scene
                </label>
                <textarea
                  value={sceneText}
                  onChange={(e) => setSceneText(e.target.value)}
                  rows={6}
                  placeholder="Paste or write the prose to depict. The LLM tags it into a prompt."
                  className="st-input mb-4 w-full resize-y"
                />

                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                    Scene instruction (scratchpad)
                  </label>
                  <button
                    type="button"
                    onClick={() => setTagInstructionOverride(null)}
                    disabled={tagInstructionOverride === null}
                    className="st-btn st-btn-sm st-btn-default"
                  >
                    Reset to saved
                  </button>
                </div>
                <select
                  value={tagPromptName || image.activeTagPrompt}
                  onChange={(e) => {
                    setTagPromptName(e.target.value)
                    setTagInstructionOverride(null)
                  }}
                  className="st-select mb-2 w-full"
                >
                  {image.tagPrompts.map((p, i) => (
                    <option key={i} value={p.name}>
                      {p.name || '(unnamed)'}
                    </option>
                  ))}
                </select>
                <textarea
                  value={tagInstructionValue}
                  onChange={(e) => setTagInstructionOverride(e.target.value)}
                  rows={4}
                  className="st-input mb-4 w-full resize-y font-mono text-xs"
                />

                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                    System prompt (scratchpad)
                  </label>
                  <button
                    type="button"
                    onClick={() => setSystemOverride(null)}
                    disabled={systemOverride === null}
                    className="st-btn st-btn-sm st-btn-default"
                  >
                    Reset to saved
                  </button>
                </div>
                <textarea
                  value={systemPromptValue}
                  onChange={(e) => setSystemOverride(e.target.value)}
                  rows={6}
                  className="st-input mb-1 w-full resize-y font-mono text-xs"
                />
                <div className="mb-4 text-[11px] text-ink-700">
                  Edits to the scene instruction and system prompt are temporary — they only affect
                  generations on this screen. To keep a good one, copy it into a saved prompt in
                  Settings → Images.
                </div>
              </>
            ) : (
              <>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
                  Prompt
                </label>
                <textarea
                  value={directPrompt}
                  onChange={(e) => setDirectPrompt(e.target.value)}
                  rows={8}
                  placeholder="Comma-separated tags / prompt fed straight to ComfyUI (skips the tagger)."
                  className="st-input mb-4 w-full resize-y font-mono text-xs"
                />
              </>
            )}

            <div className="flex items-center gap-3">
              {loading ? (
                <>
                  <button
                    type="button"
                    onClick={cancel}
                    className="st-btn st-btn-sm st-btn-default"
                  >
                    Cancel
                  </button>
                  <span className="flex items-center gap-2 text-xs text-accent-600">
                    <span className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-pulse" />
                    {phase === 'tagging'
                      ? 'Tagging scene…'
                      : phase === 'generating'
                        ? 'Generating image…'
                        : 'Working…'}
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={generate}
                  disabled={!canGenerate}
                  className="st-btn st-btn-primary"
                >
                  {result ? '↻ Regenerate' : '✨ Generate'}
                </button>
              )}
            </div>
            {error && <div className="mt-3 whitespace-pre-wrap text-sm text-danger">{error}</div>}
          </div>

          {/* ---- Result ---- */}
          <div className="st-card flex flex-col p-4">
            {result ? (
              <>
                <img
                  src={result.dataUrl}
                  alt=""
                  onClick={() => setLightbox({ src: result.dataUrl, title: result.positive })}
                  className="mb-3 max-h-[28rem] cursor-zoom-in self-center rounded-lg border border-ink-200 object-contain shadow-sm"
                />
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                    Positive prompt
                  </span>
                  <button
                    type="button"
                    onClick={copyPositive}
                    className="st-btn st-btn-sm st-btn-default"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="mb-4 max-h-24 overflow-y-auto rounded border border-ink-200 bg-ink-50 p-2 font-mono text-xs text-ink-900">
                  {result.positive}
                </div>

                <div className="mt-auto border-t border-ink-200 pt-3">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-700">
                    Save to gallery
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={saveTargetId}
                      onChange={(e) => setSaveTargetId(e.target.value)}
                      className="st-select flex-1"
                    >
                      <option value="">Choose a character…</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={saveToGallery}
                      disabled={!saveTargetId || saving}
                      className="st-btn st-btn-primary"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {savedMsg && <div className="mt-2 text-xs text-accent-600">{savedMsg}</div>}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-ink-700">
                {loading ? 'Generating…' : 'The generated image will appear here.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {lightbox && (
        <Lightbox src={lightbox.src} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
