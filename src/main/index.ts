import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerWorkspaceIpc } from './ipc/workspace'
import { registerCharactersIpc } from './ipc/characters'
import { registerKeysIpc } from './ipc/keys'
import { registerProvidersIpc } from './ipc/providers'
import { registerPresetsIpc } from './ipc/presets'
import { registerStoriesIpc } from './ipc/stories'
import { registerGenerationIpc } from './ipc/generation'
import { registerLogsIpc } from './ipc/logs'
import { registerComfyIpc } from './ipc/comfy'
import { registerImageIpc } from './ipc/image'
import { registerPluginsIpc } from './ipc/plugins'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Native modals (file dialogs, and window.confirm/alert) steal OS focus while open.
  // On Windows especially, when one closes the window frame regains focus but the web
  // page does NOT — every text field then silently ignores keyboard input until the app
  // is restarted. Re-focusing the webContents whenever the window regains focus restores
  // input reliably, and is a harmless no-op the rest of the time.
  mainWindow.on('focus', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.focus()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pde.story-tavern')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerWorkspaceIpc()
  registerCharactersIpc()
  registerKeysIpc()
  registerProvidersIpc()
  registerPresetsIpc()
  registerStoriesIpc()
  registerGenerationIpc()
  registerLogsIpc()
  registerComfyIpc()
  registerImageIpc()
  registerPluginsIpc()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
