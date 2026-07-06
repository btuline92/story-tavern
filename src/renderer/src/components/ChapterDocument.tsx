import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImageGenResult } from '../types'

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
  onChange
}: {
  value: string
  disabled: boolean
  placeholder?: string
  onChange: (v: string) => void
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
  onChange: (next: string) => void
  /** Generate a fresh image for the given passage; returns the result (no insertion). */
  onRegenerateImage: (passageText: string) => Promise<ImageGenResult | null>
}

export function ChapterDocument({
  workspace,
  storySlug,
  value,
  disabled,
  onChange,
  onRegenerateImage
}: Props): React.JSX.Element {
  const [segments, setSegments] = useState<Segment[]>(() => parse(value))
  const [imgData, setImgData] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null)
  const [busyImageId, setBusyImageId] = useState<string | null>(null)
  // The last string we serialized out. Lets us tell an external change (Continue,
  // auto-inserted image, chapter switch) — which we must re-parse — apart from the echo
  // of our own keystrokes, which we must NOT re-parse (it would reset focus/caret).
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setSegments(parse(value))
    }
  }, [value])

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
                    className="rounded-md bg-surface/90 px-2 py-1 text-xs text-red-700 shadow hover:bg-surface"
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
            <div className="max-w-2xl text-center text-xs text-white/80 font-mono">
              {lightbox.title}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
