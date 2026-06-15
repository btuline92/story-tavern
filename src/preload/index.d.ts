import { ElectronAPI } from '@electron-toolkit/preload'
import type { StoryTavernApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: StoryTavernApi
  }
}
