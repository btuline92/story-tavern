import { create } from 'zustand'

// In-app replacement for window.confirm/alert. Native dialogs blur the web contents on Windows and
// keyboard focus is not reliably returned, freezing all text inputs until restart. A React overlay
// never takes OS focus away, so input keeps working.

export interface ChoiceOption {
  label: string
  value: string
  style?: 'primary' | 'default' | 'danger'
}

type Request =
  | { kind: 'confirm'; message: string; resolve: (ok: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'choice'; message: string; options: ChoiceOption[]; resolve: (value: string | null) => void }

interface DialogState {
  current: Request | null
  /** Resolve confirm/alert. `ok` is ignored for alerts; cancels a choice dialog. */
  respond: (ok: boolean) => void
  /** Resolve a choice dialog with the picked value (null = cancelled). */
  choose: (value: string | null) => void
}

function settle(req: Request | null): void {
  if (!req) return
  if (req.kind === 'confirm') req.resolve(false)
  else if (req.kind === 'choice') req.resolve(null)
  else req.resolve()
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  respond: (ok) => {
    const cur = get().current
    if (!cur) return
    set({ current: null })
    if (cur.kind === 'confirm') cur.resolve(ok)
    else if (cur.kind === 'choice') cur.resolve(null)
    else cur.resolve()
  },
  choose: (value) => {
    const cur = get().current
    if (!cur || cur.kind !== 'choice') return
    set({ current: null })
    cur.resolve(value)
  }
}))

/** Show a confirm dialog; resolves true on OK, false on Cancel. */
export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    // If a dialog is somehow already open, cancel it so its awaiter isn't left hanging.
    settle(useDialog.getState().current)
    useDialog.setState({ current: { kind: 'confirm', message, resolve } })
  })
}

/** Show an informational alert; resolves when dismissed. */
export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    settle(useDialog.getState().current)
    useDialog.setState({ current: { kind: 'alert', message, resolve } })
  })
}

/** Show a multi-button choice dialog. Resolves to the picked option's value, or null if cancelled.
 *  A Cancel button is always shown; `options` are the affirmative choices, rendered after it. */
export function askChoice(message: string, options: ChoiceOption[]): Promise<string | null> {
  return new Promise((resolve) => {
    settle(useDialog.getState().current)
    useDialog.setState({ current: { kind: 'choice', message, options, resolve } })
  })
}
