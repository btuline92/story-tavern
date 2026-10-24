import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { getKey } from '../lib/safeStore'
import { readWorkspaceSettings, resolveModelFor } from './workspace'
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

export type ImagePhase = 'tagging' | 'generating' | 'saving'

export interface ImageGenResult {
  relPath: string
  positive: string
  negative: string
  tags: string
}

/** Options for the story-independent Photography generator (image:photograph). */
export interface PhotographOpts {
  /** Scene = run the prose through the LLM tagger; prompt = feed text straight to ComfyUI. */
  mode: 'scene' | 'prompt'
  /** Characters for the appearance reference + per-character negatives (scene mode). */
  characterIds: string[]
  /** Prose to tag (scene mode). */
  sceneText: string
  /** Raw prompt fed straight to ComfyUI, skipping the tagger (prompt mode). */
  directPrompt: string
  /** Ephemeral tagging system prompt (scene mode) — never persisted. */
  systemPrompt: string
  /** Ephemeral scene instruction (the tag prompt text, possibly edited) — never persisted. */
  tagInstruction: string
  /** Name of the prompt-prefix pair to use; falls back to the active one. */
  prefixName: string
}

/** Result of a Photography generation — the image is returned in-memory (not saved to disk). */
export interface PhotographResult {
  /** `data:image/<fmt>;base64,...` of the rendered image. */
  dataUrl: string
  positive: string
  negative: string
  tags: string
}

const activeJobs = new Map<string, AbortController>()

export function mimeForExt(ext: string): string {
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
        // Model + hyperparameters: the active model preset's image-tagging role.
        const { provider, model, generation } = resolveModelFor(settings, 'imageTagging')
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
        const interp = (s: string): string =>
          s.replace(/\{\{char\}\}/g, charNames).replace(/\{\{user\}\}/g, 'the protagonist')
        const tagInstruction = interp(activePrompt?.text ?? '')
        // Resolve the active system prompt (falls back to the first entry).
        const activeSystem =
          image.systemPrompts.find((p) => p.name === image.activeSystemPrompt) ??
          image.systemPrompts[0]
        const systemPrompt = interp(activeSystem?.text ?? '')
        const entries = buildTagEntries({
          image,
          characters,
          passageText,
          tagInstruction,
          systemPrompt
        })

        // Image tagging uses its OWN dedicated generation settings (full hyperparameters +
        // reasoning) — it no longer inherits the base model's. When reasoning is off, also
        // actively suppress it where the provider supports that (OpenRouter/OpenAI o-series).
        let tagError: string | null = null
        const metrics = await streamContinue(
          {
            provider,
            model,
            apiKey,
            generation,
            entries,
            disableReasoning: generation.reasoning_level === 'off',
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
        const activePrefix =
          image.promptPrefixes.find((p) => p.name === image.activePromptPrefix) ??
          image.promptPrefixes[0]
        const positive = combineTags(activePrefix?.positive ?? '', tags)
        const negative = combineTags(
          activePrefix?.negative ?? '',
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

  // Story-independent generator for the Photography screen. Reuses the same pipeline as
  // image:generate (tagger → prefix combine → ComfyUI) but: takes an explicit character list,
  // supports a raw "direct prompt" mode that skips the tagger, uses an ephemeral system prompt,
  // and returns the image in-memory (never written to a story dir — persistence is the caller's
  // "Save to gallery" step). Shares the activeJobs abort registry, so image:cancel covers it too.
  ipcMain.handle(
    'image:photograph',
    async (
      event,
      genId: string,
      workspace: string,
      opts: PhotographOpts
    ): Promise<PhotographResult | { error: string }> => {
      const settings = await readWorkspaceSettings(workspace)
      const image = settings.image
      if (!image.enabled) return { error: 'Image generation is disabled in settings.' }

      const characters = await readCharactersData(workspace, opts.characterIds)

      const win = event.sender
      const progress = (phase: ImagePhase): void => {
        if (!win.isDestroyed()) win.send('image:progress', genId, phase)
      }

      const activePrefix =
        image.promptPrefixes.find((p) => p.name === opts.prefixName) ??
        image.promptPrefixes.find((p) => p.name === image.activePromptPrefix) ??
        image.promptPrefixes[0]

      const ctrl = new AbortController()
      activeJobs.set(genId, ctrl)
      try {
        // --- 1. Resolve the tag string (LLM tagger for scene mode, raw text for prompt mode) ---
        let tags: string
        if (opts.mode === 'scene') {
          progress('tagging')
          const { provider, model, generation } = resolveModelFor(settings, 'imageTagging')
          const apiKey = await getKey(provider)
          if (!apiKey)
            return { error: `No API key saved for ${provider} (needed for image tagging).` }

          const charNames =
            characters
              .map((c) => c.name)
              .filter((n) => n && n.trim())
              .join(' and ') || 'the character'
          const interp = (s: string): string =>
            s.replace(/\{\{char\}\}/g, charNames).replace(/\{\{user\}\}/g, 'the protagonist')
          // Photography supplies the scene instruction as full text (a scratchpad based on a saved
          // tag prompt) — so the user can test instruction changes without persisting them.
          const tagInstruction = interp(opts.tagInstruction ?? '')
          // Photography supplies its OWN ephemeral system prompt (a scratchpad) — NOT the saved
          // active one — so the user can test system-prompt changes without persisting them.
          const systemPrompt = interp(opts.systemPrompt ?? '')
          const entries = buildTagEntries({
            image,
            characters,
            passageText: opts.sceneText,
            tagInstruction,
            systemPrompt
          })

          let tagError: string | null = null
          const metrics = await streamContinue(
            {
              provider,
              model,
              apiKey,
              generation,
              entries,
              disableReasoning: generation.reasoning_level === 'off',
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
            duration_ms: metrics.durationMs
          })
          if (ctrl.signal.aborted) return { error: 'aborted' }
          if (tagError || metrics.error)
            return { error: `Tagging failed: ${tagError ?? metrics.error}` }
          tags = cleanTagResponse(metrics.fullText)
          if (!tags) return { error: 'The LLM returned no tags.' }
        } else {
          tags = opts.directPrompt.trim()
          if (!tags) return { error: 'Enter a prompt to generate.' }
        }

        // --- 2. Build positive/negative. Per-character negatives only apply to scene mode
        // (they're a tagging concept); direct-prompt mode stays "raw" with just the prefix. ---
        const positive = combineTags(activePrefix?.positive ?? '', tags)
        const negative =
          opts.mode === 'scene'
            ? combineTags(
                activePrefix?.negative ?? '',
                ...characters.map((c) => readCharacterImageTags(c).negative_tags ?? '')
              )
            : combineTags(activePrefix?.negative ?? '')
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
            duration_ms: Date.now() - comfyStart
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
          duration_ms: Date.now() - comfyStart
        })

        // --- 4. Return the image in-memory; the caller decides whether to save it ---
        const dataUrl = `data:${mimeForExt(rendered.format)};base64,${rendered.buffer.toString('base64')}`
        return { dataUrl, positive, negative, tags }
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
