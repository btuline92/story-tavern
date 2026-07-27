import { useEffect } from 'react'
import { useDialog } from '../stores/dialog'

/** Renders the active in-app confirm/alert modal (see stores/dialog). Mounted once at the app root. */
export function AppDialogs(): React.JSX.Element | null {
  const current = useDialog((s) => s.current)
  const respond = useDialog((s) => s.respond)

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') respond(false)
      else if (e.key === 'Enter') respond(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, respond])

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onClick={() => respond(false)}
    >
      <div
        className="w-[28rem] max-w-[92vw] rounded-lg border border-ink-200 bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 whitespace-pre-wrap text-sm text-ink-900">{current.message}</div>
        <div className="flex justify-end gap-2">
          {current.kind === 'confirm' && (
            <button
              type="button"
              onClick={() => respond(false)}
              className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => respond(true)}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
