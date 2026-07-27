import { create } from 'zustand'

// In-app replacement for window.confirm/alert. Native dialogs blur the web contents on Windows and
// keyboard focus is not reliably returned, freezing all text inputs until restart. A React overlay
// never takes OS focus away, so input keeps working.

type Request =
  | { kind: 'confirm'; message: string; resolve: (ok: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void }

interface DialogState {
  current: Request | null
  /** Resolve the active request and close it. `ok` is ignored for alerts. */
  respond: (ok: boolean) => void
}

function settle(req: Request | null): void {
  if (!req) return
  if (req.kind === 'confirm') req.resolve(false)
  else req.resolve()
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  respond: (ok) => {
    const cur = get().current
    if (!cur) return
    set({ current: null })
    if (cur.kind === 'confirm') cur.resolve(ok)
    else cur.resolve()
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
