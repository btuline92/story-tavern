import { ipcMain } from 'electron'
import { ulid } from 'ulid'
import { getKey } from '../lib/safeStore'
import { readWorkspaceSettings } from './workspace'
import { loadStory } from '../lib/storyStorage'
import { getPreset, defaultPreset } from '../lib/presetStore'
import { assemble } from '../lib/promptAssembly'
import { streamContinue } from '../lib/streamGeneration'
import { logApiCall } from '../lib/apiLogger'
import { readCharacterData } from '../lib/characterData'
import type { ProviderId } from './providers'

const activeStreams = new Map<string, AbortController>()

export function registerGenerationIpc(): void {
  ipcMain.handle(
    'generation:continue-stream',
    async (
      event,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      userNote?: string
    ): Promise<{ streamId: string } | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const provider: ProviderId = settings.selectedProvider
      const model = settings.models[provider]
      const apiKey = await getKey(provider)
      if (!apiKey) return { error: `No API key saved for ${provider}` }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }

      // Resolve preset: story's preset_id wins, else workspace active preset, else built-in default.
      const presetId = story.meta.preset_id ?? settings.activePresetId
      const preset = (presetId ? await getPreset(workspace, presetId) : null) ?? defaultPreset()

      const character = await readCharacterData(workspace, story.meta.character_id)

      const entries = assemble(preset, {
        character,
        storyTitle: story.meta.title,
        storyPremise: story.meta.premise ?? '',
        chapters: story.chapters.map((c) => ({
          number: c.number,
          title: c.title,
          outline: c.outline,
          content: c.content
        })),
        activeChapterNumber: chapterNumber,
        userNote
      })

      const streamId = ulid()
      const ctrl = new AbortController()
      activeStreams.set(streamId, ctrl)

      const win = event.sender
      const sendDelta = (text: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:delta', streamId, text)
      }
      const sendReasoning = (text: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:reasoning', streamId, text)
      }
      const sendDone = (fullText: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:done', streamId, fullText)
      }
      const sendError = (err: string): void => {
        if (!win.isDestroyed()) win.send('generation:stream:error', streamId, err)
      }

      void (async () => {
        const start = Date.now()
        try {
          const metrics = await streamContinue(
            {
              provider,
              model,
              apiKey,
              generation: settings.generation,
              entries,
              openrouter: settings.openrouter
            },
            ctrl.signal,
            { onDelta: sendDelta, onReasoning: sendReasoning, onDone: sendDone, onError: sendError }
          )
          if (ctrl.signal.aborted) sendError('aborted')
          await logApiCall(workspace, {
            provider,
            model,
            kind: 'continue-stream',
            url: metrics.url,
            request_body: metrics.requestBody,
            status: metrics.status,
            response_body: JSON.stringify(
              {
                text: metrics.fullText,
                reasoning: metrics.reasoningText,
                chunk_count: metrics.chunkCount
              },
              null,
              2
            ),
            error: metrics.error,
            duration_ms: metrics.durationMs,
            story_id: storyId,
            chapter_number: chapterNumber,
            stream_chunks: metrics.chunkCount
          })
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          sendError(err)
          await logApiCall(workspace, {
            provider,
            model,
            kind: 'continue-stream',
            url: '',
            status: null,
            error: err,
            duration_ms: Date.now() - start,
            story_id: storyId,
            chapter_number: chapterNumber
          })
        } finally {
          activeStreams.delete(streamId)
        }
      })()

      return { streamId }
    }
  )

  ipcMain.handle('generation:cancel', async (_e, streamId: string) => {
    const ctrl = activeStreams.get(streamId)
    if (ctrl) {
      ctrl.abort()
      activeStreams.delete(streamId)
      return true
    }
    return false
  })
}
