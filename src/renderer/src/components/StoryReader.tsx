import { useEffect, useMemo, useRef, useState } from 'react'
import { useStories } from '../stores/stories'
import { parse } from '../lib/chapterSegments'

// Reader-only, session-ephemeral preferences.
const FONT_SIZES = ['text-base', 'text-lg', 'text-xl', 'text-2xl'] as const
const WIDTHS = [
  { label: 'Narrow', cls: 'max-w-xl' },
  { label: 'Medium', cls: 'max-w-2xl' },
  { label: 'Wide', cls: 'max-w-3xl' }
] as const
const WPM = 230

const BTN = 'rounded-md border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40'
const SELECT = 'rounded-md border border-ink-200 bg-surface px-2 py-1 text-sm focus:outline-none'

/** Split a text segment into paragraphs on blank lines; single newlines stay (whitespace-pre-wrap). */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+$/gm, '').trim())
    .filter((p) => p.length > 0)
}

interface Props {
  workspace: string
  /** Label for the back button — reflects where the reader was opened from (editor vs list). */
  backLabel: string
  onExit: () => void
}

/**
 * Distraction-free, read-only reader. Replaces the whole 3-pane editor so prose gets the full window.
 * Shows one chapter at a time (chapter menu + Prev/Next via the store's selectChapter), reusing the
 * shared parser and the same image loader/lightbox as the editor. All prefs here are local/ephemeral.
 */
export function StoryReader({ workspace, backLabel, onExit }: Props): React.JSX.Element | null {
  const { active, activeChapterNumber, selectChapter } = useStories()
  const [imgData, setImgData] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [fontIdx, setFontIdx] = useState(1) // text-lg
  const [widthIdx, setWidthIdx] = useState(1) // Medium
  const [progress, setProgress] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const chapters = useMemo(
    () => (active ? [...active.chapters].sort((a, b) => a.number - b.number) : []),
    [active]
  )
  const idx = chapters.findIndex((c) => c.number === activeChapterNumber)
  const chapter = idx >= 0 ? chapters[idx] : (chapters[0] ?? null)
  const prevNum = idx > 0 ? chapters[idx - 1].number : null
  const nextNum = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1].number : null

  const segments = useMemo(() => (chapter ? parse(chapter.content) : []), [chapter])

  const words = useMemo(
    () =>
      segments
        .map((s) => (s.kind === 'text' ? s.text : ''))
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length,
    [segments]
  )
  const minutes = Math.max(1, Math.ceil(words / WPM))

  // Load image data URLs for the current chapter's image segments (one chapter at a time = light).
  useEffect(() => {
    if (!active) return
    for (const s of segments) {
      if (s.kind === 'image' && imgData[s.src] === undefined) {
        window.api.image
          .readFile(workspace, active.meta.slug, s.src)
          .then((data) => {
            if (data) setImgData((prev) => ({ ...prev, [s.src]: data }))
          })
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, workspace, active?.meta.slug])

  // Reset scroll + progress whenever the chapter changes.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    setProgress(0)
  }, [activeChapterNumber])

  // Keyboard nav: ←/→ change chapters, Esc exits. Ignore while a form control is focused so the
  // chapter menu's own arrow behavior still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onExit()
        return
      }
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && prevNum != null) selectChapter(prevNum)
      else if (e.key === 'ArrowRight' && nextNum != null) selectChapter(nextNum)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [prevNum, nextNum, onExit, selectChapter])

  if (!active) return null

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const max = el.scrollHeight - el.clientHeight
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0)
  }

  const copyPrompt = (title: string): void => {
    void navigator.clipboard.writeText(title)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="flex h-full flex-col bg-ink-50">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-ink-200 bg-surface px-4 py-2">
        <button type="button" onClick={onExit} className={BTN}>
          {backLabel}
        </button>
        <div className="min-w-0 flex-1 truncate text-sm text-ink-700">
          {active.meta.title || 'Untitled'}
        </div>

        {/* Chapter nav */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => prevNum != null && selectChapter(prevNum)}
            disabled={prevNum == null}
            title="Previous chapter (←)"
            className={BTN}
          >
            ‹
          </button>
          <select
            value={activeChapterNumber ?? ''}
            onChange={(e) => selectChapter(Number(e.target.value))}
            className={`${SELECT} max-w-[14rem]`}
          >
            {chapters.map((c, i) => (
              <option key={c.id} value={c.number}>
                {`${i + 1}. ${c.title || 'Untitled'}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => nextNum != null && selectChapter(nextNum)}
            disabled={nextNum == null}
            title="Next chapter (→)"
            className={BTN}
          >
            ›
          </button>
        </div>

        {/* Reading controls */}
        <div className="flex shrink-0 items-center gap-2 border-l border-ink-200 pl-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
              disabled={fontIdx === 0}
              title="Smaller text"
              className={BTN}
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
              disabled={fontIdx === FONT_SIZES.length - 1}
              title="Larger text"
              className={BTN}
            >
              A+
            </button>
          </div>
          <select
            value={widthIdx}
            onChange={(e) => setWidthIdx(Number(e.target.value))}
            title="Reading width"
            className={SELECT}
          >
            {WIDTHS.map((w, i) => (
              <option key={w.cls} value={i}>
                {w.label}
              </option>
            ))}
          </select>
          <div className="whitespace-nowrap text-xs text-ink-700">
            {words.toLocaleString()} words · {minutes} min
          </div>
        </div>
      </div>

      {/* Scroll progress */}
      <div className="h-0.5 w-full bg-ink-100">
        <div
          className="h-full bg-accent-500 transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Body */}
      <div ref={bodyRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {chapter ? (
          <div className={`mx-auto ${WIDTHS[widthIdx].cls} px-6 py-10`}>
            <h1 className="mb-6 font-serif text-2xl font-semibold text-ink-900">
              {chapter.title || `Chapter ${chapter.number}`}
            </h1>
            {segments.map((seg) =>
              seg.kind === 'text' ? (
                <div key={seg.id}>
                  {paragraphsOf(seg.text).map((p, i) => (
                    <p
                      key={`${seg.id}-${i}`}
                      className={`mb-5 whitespace-pre-wrap font-serif leading-relaxed text-ink-900 ${FONT_SIZES[fontIdx]}`}
                    >
                      {p}
                    </p>
                  ))}
                </div>
              ) : (
                <figure key={seg.id} className="my-6 flex flex-col items-center">
                  {imgData[seg.src] ? (
                    <img
                      src={imgData[seg.src]}
                      alt={seg.alt}
                      onClick={() => setLightbox({ src: imgData[seg.src], title: seg.title })}
                      className="max-h-[32rem] cursor-zoom-in rounded-lg border border-ink-200 object-contain shadow-sm"
                    />
                  ) : (
                    <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-ink-200 text-sm text-ink-700">
                      Loading image…
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
        ) : (
          <div className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-ink-700">
            This story has no chapters yet.
          </div>
        )}
      </div>

      {/* Lightbox */}
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
                onClick={() => copyPrompt(lightbox.title)}
                className="st-btn st-btn-sm st-btn-default"
              >
                {copied ? 'Copied!' : 'Copy prompt'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
