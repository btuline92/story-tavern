import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { getKey } from '../lib/safeStore'
import { readWorkspaceSettings } from './workspace'
import { loadStory } from '../lib/storyStorage'
import { streamContinue } from '../lib/streamGeneration'
import { logApiCall } from '../lib/apiLogger'
import { readCharactersData, readCharacterImageTags } from '../lib/characterData'
import {
  buildTagEntries,
  cleanTagResponse,
  combineTags,
  substitutePlaceholders
} from '../lib/imagePrompt'
import { readWorkflow } from '../lib/comfyWorkflows'
import { submitAndFetchImage } from '../lib/comfyClient'
import type { GenerationSettings } from './workspace'
import type { ProviderId } from './providers'

export type ImagePhase = 'tagging' | 'generating' | 'saving'

export interface ImageGenResult {
  relPath: string
  positive: string
  negative: string
  tags: string
}

const activeJobs = new Map<string, AbortController>()

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

export function registerImageIpc(): void {
  ipcMain.handle(
    'image:generate',
    async (
      event,
      genId: string,
      workspace: string,
      storyId: string,
      chapterNumber: number,
      passageText: string
    ): Promise<ImageGenResult | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const image = settings.image
      if (!image.enabled) return { error: 'Image generation is disabled in settings.' }

      const story = await loadStory(workspace, storyId)
      if (!story) return { error: `Story not found: ${storyId}` }
      const characters = await readCharactersData(workspace, story.meta.character_ids)

      const win = event.sender
      const progress = (phase: ImagePhase): void => {
        if (!win.isDestroyed()) win.send('image:progress', genId, phase)
      }

      const ctrl = new AbortController()
      activeJobs.set(genId, ctrl)
      try {
        // --- 1. Tag the passage with the LLM ---
        progress('tagging')
        let provider: ProviderId = settings.selectedProvider
        let model = settings.models[provider]
        if (image.tagModelOverride.enabled && image.tagModelOverride.model) {
          provider = image.tagModelOverride.provider
          model = image.tagModelOverride.model
        }
        const apiKey = await getKey(provider)
        if (!apiKey)
          return { error: `No API key saved for ${provider} (needed for image tagging).` }

        const activePrompt =
          image.tagPrompts.find((p) => p.name === image.activeTagPrompt) ?? image.tagPrompts[0]
        // Interpolate character macros in the tag prompt (e.g. the Male POV prompt uses
        // {{char}} / {{user}}), matching how the story prompt assembler resolves them.
        const charNames =
          characters
            .map((c) => c.name)
            .filter((n) => n && n.trim())
            .join(' and ') || 'the character'
        const tagInstruction = (activePrompt?.text ?? '')
          .replace(/\{\{char\}\}/g, charNames)
          .replace(/\{\{user\}\}/g, 'the protagonist')
        const entries = buildTagEntries({ image, characters, passageText, tagInstruction })
        const disableThinking = image.tagDisableThinking
        // Inherit the workspace LLM settings for tagging; the ONLY sampling override is
        // temperature (tagTemperature). Reasoning is controlled separately by the tag-thinking
        // toggle. Previously we clobbered top_p/top_k/penalties/etc. with defaults, which lost
        // the user's configured values (e.g. sent top_p=1 instead of the settings' 0.95).
        const tagGen: GenerationSettings = {
          ...settings.generation,
          temperature: image.tagTemperature,
          reasoning_level: disableThinking ? 'off' : settings.generation.reasoning_level
        }

        let tagError: string | null = null
        const metrics = await streamContinue(
          {
            provider,
            model,
            apiKey,
            generation: tagGen,
            entries,
            disableReasoning: disableThinking,
            openrouter: settings.openrouter
          },
          ctrl.signal,
          {
            onDelta: () => {},
            onReasoning: () => {},
            onDone: () => {},
            onError: (e) => {
              tagError = e
            }
          }
        )
        await logApiCall(workspace, {
          provider,
          model,
          kind: 'image-tags',
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
          chapter_number: chapterNumber
        })
        if (ctrl.signal.aborted) return { error: 'aborted' }
        if (tagError || metrics.error)
          return { error: `Tagging failed: ${tagError ?? metrics.error}` }

        const tags = cleanTagResponse(metrics.fullText)
        if (!tags) return { error: 'The LLM returned no tags.' }

        // --- 2. Build the positive/negative prompts ---
        // Per-character appearance is embedded by the tagger (it has each character's appearance
        // tags in the reference block), so we don't prepend appearance globally — that would
        // detach it from the character's phrase in a multi-character scene. We do roll every
        // character's negative tags into the shared negative prompt.
        const positive = combineTags(image.promptPrefix, tags)
        const negative = combineTags(
          image.negativePrompt,
          ...characters.map((c) => readCharacterImageTags(c).negative_tags ?? '')
        )
        const seed =
          image.seed >= 0 ? image.seed : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

        // --- 3. Substitute placeholders and queue on ComfyUI ---
        progress('generating')
        const workflowJson = await readWorkflow(workspace, image.workflow)
        const substituted = substitutePlaceholders(workflowJson, {
          image,
          positive,
          negative,
          seed
        })

        const comfyStart = Date.now()
        let rendered: { format: string; buffer: Buffer }
        try {
          rendered = await submitAndFetchImage(image.comfyUrl, substituted, ctrl.signal)
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          await logApiCall(workspace, {
            provider: 'comfyui',
            model: image.workflow,
            kind: 'image-generate',
            url: image.comfyUrl,
            request_body: substituted,
            status: null,
            error: err,
            duration_ms: Date.now() - comfyStart,
            story_id: storyId,
            chapter_number: chapterNumber
          })
          if (ctrl.signal.aborted || err === 'aborted') return { error: 'aborted' }
          return { error: err }
        }
        await logApiCall(workspace, {
          provider: 'comfyui',
          model: image.workflow,
          kind: 'image-generate',
          url: image.comfyUrl,
          request_body: substituted,
          status: 200,
          response_body: `[${rendered.format} image, ${rendered.buffer.length} bytes]`,
          duration_ms: Date.now() - comfyStart,
          story_id: storyId,
          chapter_number: chapterNumber
        })

        // --- 4. Save the image under the story ---
        progress('saving')
        const imagesDir = join(workspace, 'stories', story.meta.slug, 'images')
        await mkdir(imagesDir, { recursive: true })
        const ext = rendered.format === 'jpeg' ? 'jpg' : rendered.format
        const fileName = `${ulid()}.${ext}`
        await writeFile(join(imagesDir, fileName), rendered.buffer)

        return { relPath: `images/${fileName}`, positive, negative, tags }
      } catch (e) {
        if (ctrl.signal.aborted) return { error: 'aborted' }
        return { error: e instanceof Error ? e.message : String(e) }
      } finally {
        activeJobs.delete(genId)
      }
    }
  )

  ipcMain.handle('image:cancel', async (_e, genId: string): Promise<boolean> => {
    const ctrl = activeJobs.get(genId)
    if (ctrl) {
      ctrl.abort()
      activeJobs.delete(genId)
      return true
    }
    return false
  })

  ipcMain.handle(
    'image:read-file',
    async (_e, workspace: string, storySlug: string, relPath: string): Promise<string | null> => {
      // Guard against path traversal — only allow files inside the story's images dir.
      if (relPath.includes('..')) return null
      const full = join(workspace, 'stories', storySlug, relPath)
      if (!existsSync(full)) return null
      const buf = await readFile(full)
      const ext = relPath.split('.').pop() ?? 'png'
      return `data:${mimeForExt(ext)};base64,${buf.toString('base64')}`
    }
  )
}
