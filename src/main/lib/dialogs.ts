import { BrowserWindow, dialog } from 'electron'
import type {
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'

/**
 * Show native open/save dialogs parented to the window that sent the IPC call.
 *
 * An unparented native dialog is a separate top-level window; on Windows, when it closes the
 * OS returns focus to the app's window frame but NOT to its web contents, so every text field
 * silently ignores keyboard input until the app is restarted. Passing the parent BrowserWindow
 * makes the dialog modal to that window and returns focus to its web contents on close.
 * (The main window's `focus` handler re-focuses the webContents as a second line of defense.)
 */
export function showOpenDialog(
  e: IpcMainInvokeEvent,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  const win = BrowserWindow.fromWebContents(e.sender)
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

export function showSaveDialog(
  e: IpcMainInvokeEvent,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const win = BrowserWindow.fromWebContents(e.sender)
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}
