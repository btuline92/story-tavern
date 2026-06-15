import { ipcMain } from 'electron'
import {
  addChapter,
  appendToChapter,
  createStory,
  CreateStoryInput,
  deleteChapter,
  deleteStory,
  listStories,
  loadStory,
  StoryMetaUpdate,
  updateChapter,
  updateStoryMeta,
  UpdateChapterInput
} from '../lib/storyStorage'

export function registerStoriesIpc(): void {
  ipcMain.handle('stories:list', (_e, workspace: string) => listStories(workspace))
  ipcMain.handle('stories:load', (_e, workspace: string, id: string) => loadStory(workspace, id))
  ipcMain.handle(
    'stories:create',
    (_e, workspace: string, input: CreateStoryInput) => createStory(workspace, input)
  )
  ipcMain.handle(
    'stories:update-meta',
    (_e, workspace: string, id: string, patch: StoryMetaUpdate) =>
      updateStoryMeta(workspace, id, patch)
  )
  ipcMain.handle('stories:delete', async (_e, workspace: string, id: string) => {
    await deleteStory(workspace, id)
    return true
  })

  ipcMain.handle(
    'stories:update-chapter',
    (_e, workspace: string, storyId: string, chapterNumber: number, patch: UpdateChapterInput) =>
      updateChapter(workspace, storyId, chapterNumber, patch)
  )
  ipcMain.handle(
    'stories:append-chapter',
    (_e, workspace: string, storyId: string, chapterNumber: number, text: string) =>
      appendToChapter(workspace, storyId, chapterNumber, text)
  )
  ipcMain.handle(
    'stories:add-chapter',
    (_e, workspace: string, storyId: string, title?: string) =>
      addChapter(workspace, storyId, title)
  )
  ipcMain.handle(
    'stories:delete-chapter',
    async (_e, workspace: string, storyId: string, chapterNumber: number) => {
      await deleteChapter(workspace, storyId, chapterNumber)
      return true
    }
  )
}
