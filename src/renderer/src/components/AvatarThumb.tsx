import { useEffect, useState } from 'react'

/** Lazy-loads a character avatar into an <img>, falling back to a letter tile. */
export function AvatarThumb({
  workspace,
  avatar,
  name,
  sizeClass = 'h-12 w-12'
}: {
  workspace: string
  avatar: string | null
  name: string
  /** Tailwind width/height classes for the thumbnail (defaults to a list-row size). */
  sizeClass?: string
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (avatar) {
      window.api.characters
        .readAvatar(workspace, avatar)
        .then((dataUrl) => {
          if (!cancelled) setSrc(dataUrl)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [workspace, avatar])
  if (src) {
    return <img src={src} alt={name} className={`${sizeClass} rounded object-cover bg-ink-200`} />
  }
  return (
    <div
      className={`${sizeClass} rounded bg-ink-200 flex items-center justify-center text-ink-700 font-semibold`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}
