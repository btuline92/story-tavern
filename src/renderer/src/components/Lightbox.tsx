import { useState } from 'react'

/**
 * Full-screen image overlay with an optional prompt caption + copy button.
 * Click anywhere outside the caption box to close.
 */
export function Lightbox({
  src,
  title,
  onClose
}: {
  src: string
  title?: string
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    if (!title) return
    navigator.clipboard
      .writeText(title)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/70 p-8"
      onClick={onClose}
    >
      <img src={src} alt="" className="max-h-[80vh] max-w-full rounded-lg object-contain" />
      {title && (
        <div
          className="flex max-w-2xl flex-col items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center text-xs text-white/80 font-mono">{title}</div>
          <button type="button" onClick={copy} className="st-btn st-btn-sm st-btn-default">
            {copied ? 'Copied!' : 'Copy prompt'}
          </button>
        </div>
      )}
    </div>
  )
}
