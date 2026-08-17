import { useEffect } from 'react'
import { useDialog } from '../stores/dialog'
import type { ChoiceOption } from '../stores/dialog'

const BTN_DEFAULT = 'rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100'
const BTN_PRIMARY =
  'rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600'
const BTN_DANGER = 'rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90'

function optionClass(style: ChoiceOption['style']): string {
  return style === 'danger' ? BTN_DANGER : style === 'primary' ? BTN_PRIMARY : BTN_DEFAULT
}

/** Renders the active in-app confirm/alert/choice modal (see stores/dialog). Mounted once at the app root. */
export function AppDialogs(): React.JSX.Element | null {
  const current = useDialog((s) => s.current)
  const respond = useDialog((s) => s.respond)
  const choose = useDialog((s) => s.choose)

  useEffect(() => {
    if (!current) return
    // Cancel action: choice cancels to null; confirm/alert use respond(false).
    const cancel = (): void => {
      if (current.kind === 'choice') choose(null)
      else respond(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      else if (e.key === 'Enter') {
        if (current.kind === 'choice') {
          // Enter picks the primary option, else the last (rightmost) option.
          const primary =
            current.options.find((o) => o.style === 'primary') ??
            current.options[current.options.length - 1]
          if (primary) choose(primary.value)
        } else respond(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, respond, choose])

  if (!current) return null

  const cancel = (): void => {
    if (current.kind === 'choice') choose(null)
    else respond(false)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onClick={cancel}
    >
      <div
        className="w-[28rem] max-w-[92vw] rounded-lg border border-ink-200 bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 whitespace-pre-wrap text-sm text-ink-900">{current.message}</div>
        <div className="flex flex-wrap justify-end gap-2">
          {current.kind === 'choice' ? (
            <>
              <button type="button" onClick={() => choose(null)} className={BTN_DEFAULT}>
                Cancel
              </button>
              {current.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => choose(o.value)}
                  className={optionClass(o.style)}
                >
                  {o.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {current.kind === 'confirm' && (
                <button type="button" onClick={() => respond(false)} className={BTN_DEFAULT}>
                  Cancel
                </button>
              )}
              <button type="button" autoFocus onClick={() => respond(true)} className={BTN_PRIMARY}>
                OK
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
