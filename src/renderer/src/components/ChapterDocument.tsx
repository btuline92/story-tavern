import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImageGenResult } from '../types'
import { RewriteDialog } from './RewriteDialog'

type Segment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'image'; id: string; alt: string; src: string; title: string }

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

function parse(value: string): Segment[] {
  const segs: Segment[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  IMAGE_RE.lastIndex = 0
  while ((m = IMAGE_RE.exec(value)) !== null) {
    segs.push({ kind: 'text', id: `t${i}`, text: value.slice(last, m.index) })
    segs.push({ kind: 'image', id: `i${i}`, alt: m[1], src: m[2], title: m[3] ?? '' })
    last = m.index + m[0].length
    i++
  }
  segs.push({ kind: 'text', id: `t${i}`, text: value.slice(last) })
  return segs
}

function serialize(segs: Segment[]): string {
  return segs
    .map((s) =>
      s.kind === 'text' ? s.text : `![${s.alt}](${s.src}${s.title ? ` "${s.title}"` : ''})`
    )
    .join('')
}

function AutoTextarea({
  value,
  disabled,
  placeholder,
  onChange,
  onSelect
}: {
  value: string
  disabled: boolean
  placeholder?: string
  onChange: (v: string) => void
  /** Fires with the current selection range + a screen anchor (mouse point, else the textarea). */
  onSelect?: (start: number, end: number, x: number, y: number) => void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onMouseUp={(e) => {
        const el = e.currentTarget
        onSelect?.(el.selectionStart, el.selectionEnd, e.clientX, e.clientY)
      }}
      onKeyUp={(e) => {
        const el = e.currentTarget
        if (el.selectionStart !== el.selectionEnd) {
          const r = el.getBoundingClientRect()
          onSelect?.(el.selectionStart, el.selectionEnd, r.left + 48, r.top + 24)
        }
      }}
      rows={1}
      className="w-full resize-none overflow-hidden bg-transparent text-base leading-relaxed font-serif focus:outline-none disabled:text-ink-700"
    />
  )
}

interface Props {
  workspace: string
  storySlug: string
  value: string
  disabled: boolean
  /** Whether image generation is enabled (gates the selection "Image" action). */
  imageEnabled: boolean
  onChange: (next: string) => void
  /** Generate a fresh image for the given passage; returns the result (no insertion). */
  onRegenerateImage: (passageText: string) => Promise<ImageGenResult | null>
  /** AI-rewrite a highlighted passage per an instruction (returns text, no insertion). */
  onRewrite: (
    passage: string,
    instruction: string
  ) => Promise<{ text: string } | { error: string }>
}

export function ChapterDocument({
  workspace,
  storySlug,
  value,
  disabled,
  imageEnabled,
  onChange,
  onRegenerateImage,
  onRewrite
}: Props): React.JSX.Element {
  const [segments, setSegments] = useState<Segment[]>(() => parse(value))
  const [imgData, setImgData] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null)
  const [busyImageId, setBusyImageId] = useState<string | null>(null)
  // Which copy button was last clicked (image id, or 'lightbox') — drives the brief "copied" tick.
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // The last string we serialized out. Lets us tell an external change (Continue,
  // auto-inserted image, chapter switch) — which we must re-parse — apart from the echo
  // of our own keystrokes, which we must NOT re-parse (it would reset focus/caret).
  const lastEmitted = useRef(value)
  // Highlight-to-act: the active selection (drives the floating toolbar), and the passage captured
  // for the rewrite dialog (survives the selection clearing when the dialog opens).
  const [selection, setSelection] = useState<{
    segId: string
    start: number
    end: number
    text: string
    x: number
    y: number
  } | null>(null)
  const [rewriteTarget, setRewriteTarget] = useState<{
    segId: string
    start: number
    end: number
    text: string
  } | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const insertCounter = useRef(0)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setSegments(parse(value))
    }
  }, [value])

  // Dismiss the selection toolbar on outside click / scroll / Escape.
  useEffect(() => {
    if (!selection) return
    const onDown = (e: MouseEvent): void => {
      if (toolbarRef.current?.contains(e.target as Node)) return
      setSelection(null)
    }
    const onScroll = (): void => setSelection(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelection(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [selection])

  // Load image data URLs for any image segments we haven't fetched yet.
  useEffect(() => {
    const srcs = segments.filter(
      (s): s is Extract<Segment, { kind: 'image' }> => s.kind === 'image'
    )
    for (const s of srcs) {
      if (imgData[s.src] === undefined) {
        window.api.image
          .readFile(workspace, storySlug, s.src)
          .then((data) => {
            if (data) setImgData((prev) => ({ ...prev, [s.src]: data }))
          })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, workspace, storySlug])

  const commit = (next: Segment[]): void => {
    setSegments(next)
    const serialized = serialize(next)
    lastEmitted.current = serialized
    onChange(serialized)
  }

  const updateText = (id: string, text: string): void => {
    setSelection(null) // typing dismisses the selection toolbar
    commit(segments.map((s) => (s.kind === 'text' && s.id === id ? { ...s, text } : s)))
  }

  const deleteImage = (id: string): void => {
    const next = segments.filter((s) => s.id !== id)
    // Collapse the blank lines that surrounded the removed image.
    const collapsed = serialize(next).replace(/\n{3,}/g, '\n\n')
    setSegments(parse(collapsed))
    lastEmitted.current = collapsed
    onChange(collapsed)
  }

  const regenerate = async (index: number): Promise<void> => {
    // Use the nearest preceding non-empty text block as the passage to depict.
    let passage = ''
    for (let i = index - 1; i >= 0; i--) {
      const s = segments[i]
      if (s.kind === 'text' && s.text.trim()) {
        passage = s.text.trim()
        break
      }
    }
    if (!passage) passage = serialize(segments).replace(IMAGE_RE, '').trim()
    const target = segments[index]
    if (target.kind !== 'image') return
    setBusyImageId(target.id)
    try {
      const result = await onRegenerateImage(passage)
      if (result) {
        commit(
          segments.map((s) =>
            s.id === target.id && s.kind === 'image'
              ? { ...s, src: result.relPath, title: result.positive }
              : s
          )
        )
        // Drop the old cached data so the new image loads.
        setImgData((prev) => {
          const next = { ...prev }
          delete next[result.relPath]
          return next
        })
      }
    } finally {
      setBusyImageId(null)
    }
  }

  const copyPrompt = (text: string, key: string): void => {
    if (!text) return
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
      })
      .catch(() => {})
  }

  // --- Highlight-to-act ---
  const handleSelect = (segId: string, start: number, end: number, x: number, y: number): void => {
    if (disabled || start === end) {
      setSelection(null)
      return
    }
    const seg = segments.find((s) => s.id === segId)
    if (!seg || seg.kind !== 'text' || !seg.text.slice(start, end).trim()) {
      setSelection(null)
      return
    }
    setSelection({ segId, start, end, text: seg.text.slice(start, end), x, y })
  }

  /** Locate the captured passage in its segment — by offsets, else by search (handles minor drift). */
  const locate = (
    segId: string,
    start: number,
    end: number,
    text: string
  ): { seg: Extract<Segment, { kind: 'text' }>; index: number; s: number; e: number } | null => {
    const index = segments.findIndex((x) => x.id === segId)
    const seg = segments[index]
    if (!seg || seg.kind !== 'text') return null
    let s = start
    let e = end
    if (seg.text.slice(s, e) !== text) {
      const idx = seg.text.indexOf(text)
      if (idx < 0) return null
      s = idx
      e = idx + text.length
    }
    return { seg, index, s, e }
  }

  const openRewrite = (): void => {
    if (!selection) return
    const { segId, start, end, text } = selection
    setRewriteTarget({ segId, start, end, text })
    setSelection(null)
  }

  const applyRewrite = (newText: string): void => {
    const t = rewriteTarget
    if (!t) return
    const loc = locate(t.segId, t.start, t.end, t.text)
    if (!loc) return
    const nextText = loc.seg.text.slice(0, loc.s) + newText + loc.seg.text.slice(loc.e)
    commit(segments.map((x) => (x.id === loc.seg.id ? { ...x, text: nextText } : x)))
  }

  const imageFromSelection = async (): Promise<void> => {
    const sel = selection
    if (!sel) return
    setSelection(null)
    const loc = locate(sel.segId, sel.start, sel.end, sel.text)
    if (!loc) return
    const result = await onRegenerateImage(sel.text.trim())
    if (!result) return
    const cur = loc.seg.text
    // Split the text segment at the selection end and insert an image between the halves.
    const before = cur.slice(0, loc.e).replace(/\s+$/, '') + '\n\n'
    const after = '\n\n' + cur.slice(loc.e).replace(/^\s+/, '')
    const imgSeg: Segment = {
      kind: 'image',
      id: `ins${insertCounter.current++}`,
      alt: 'scene',
      src: result.relPath,
      title: result.positive
    }
    commit([
      ...segments.slice(0, loc.index),
      { kind: 'text', id: loc.seg.id, text: before },
      imgSeg,
      { kind: 'text', id: `${loc.seg.id}b${insertCounter.current++}`, text: after },
      ...segments.slice(loc.index + 1)
    ])
  }

  return (
    <div className="absolute inset-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        {segments.map((seg, idx) =>
          seg.kind === 'text' ? (
            <AutoTextarea
              key={seg.id}
              value={seg.text}
              disabled={disabled}
              placeholder={
                segments.length === 1
                  ? 'Start writing here, or click Continue ▶ to have the LLM begin the chapter for you.'
                  : undefined
              }
              onChange={(v) => updateText(seg.id, v)}
              onSelect={(start, end, x, y) => handleSelect(seg.id, start, end, x, y)}
            />
          ) : (
            <figure key={seg.id} className="group relative my-4 flex flex-col items-center">
              {imgData[seg.src] ? (
                <img
                  src={imgData[seg.src]}
                  alt={seg.alt}
                  onClick={() => setLightbox({ src: imgData[seg.src], title: seg.title })}
                  className="max-h-[28rem] cursor-zoom-in rounded-lg border border-ink-200 object-contain shadow-sm"
                />
              ) : (
                <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-ink-200 text-sm text-ink-700">
                  {busyImageId === seg.id ? 'Regenerating…' : 'Loading image…'}
                </div>
              )}
              {!disabled && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => copyPrompt(seg.title, seg.id)}
                    disabled={!seg.title}
                    title="Copy this image's prompt"
                    className="rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-900 shadow hover:bg-surface disabled:opacity-50"
                  >
                    {copiedKey === seg.id ? '✓' : '⧉'}
                  </button>
                  <button
                    type="button"
                    onClick={() => regenerate(idx)}
                    disabled={busyImageId !== null}
                    title="Regenerate this image from the preceding passage"
                    className="rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-900 shadow hover:bg-surface disabled:opacity-50"
                  >
                    ⟳
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteImage(seg.id)}
                    title="Remove this image"
                    className="rounded-md bg-surface/90 px-2 py-1 text-xs text-danger shadow hover:bg-surface"
                  >
                    ✕
                  </button>
                </div>
              )}
              {seg.title && (
                <figcaption className="mt-1 max-w-2xl truncate text-center text-xs text-ink-700 font-sans">
                  {seg.title}
                </figcaption>
              )}
            </figure>
          )
        )}
      </div>

      {selection && !disabled && (
        <div
          ref={toolbarRef}
          className="fixed z-40 flex gap-1 rounded-md border border-ink-200 bg-surface p-1 shadow-lg"
          style={{ left: Math.min(selection.x, window.innerWidth - 190), top: selection.y + 10 }}
        >
          <button
            type="button"
            onClick={openRewrite}
            className="rounded px-2 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100"
          >
            ✨ Rewrite
          </button>
          {imageEnabled && (
            <button
              type="button"
              onClick={() => void imageFromSelection()}
              className="rounded px-2 py-1 text-xs font-medium text-ink-900 hover:bg-ink-100"
            >
              🖼 Image
            </button>
          )}
        </div>
      )}

      <RewriteDialog
        open={rewriteTarget != null}
        passage={rewriteTarget?.text ?? ''}
        onGenerate={(passage, instruction) => onRewrite(passage, instruction)}
        onAccept={applyRewrite}
        onClose={() => setRewriteTarget(null)}
      />

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/70 p-8"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.src}
            alt=""
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
          {lightbox.title && (
            <div
              className="flex max-w-2xl flex-col items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center text-xs text-white/80 font-mono">{lightbox.title}</div>
              <button
                type="button"
                onClick={() => copyPrompt(lightbox.title, 'lightbox')}
                className="st-btn st-btn-sm st-btn-default"
              >
                {copiedKey === 'lightbox' ? 'Copied!' : 'Copy prompt'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
