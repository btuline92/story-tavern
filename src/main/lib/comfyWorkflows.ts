import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A minimal txt2img workflow using `%placeholder%` tokens, mirroring
 * SillyTavern's Default_Comfy_Workflow.json. Placeholders are substituted by
 * string replacement before the workflow is queued on ComfyUI.
 */
export const DEFAULT_WORKFLOW_JSON = `{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "cfg": "%scale%",
      "denoise": "%denoise%",
      "latent_image": ["5", 0],
      "model": ["4", 0],
      "negative": ["7", 0],
      "positive": ["6", 0],
      "sampler_name": "%sampler%",
      "scheduler": "%scheduler%",
      "seed": "%seed%",
      "steps": "%steps%"
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "%model%" }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": { "batch_size": 1, "height": "%height%", "width": "%width%" }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "clip": ["4", 1], "text": "%prompt%" }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": { "clip": ["4", 1], "text": "%negative_prompt%" }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "StoryTavern", "images": ["8", 0] }
  }
}
`

function workflowsDir(workspace: string): string {
  return join(workspace, 'comfy-workflows')
}

function sanitizeName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '')
  const withExt = base.endsWith('.json') ? base : `${base}.json`
  return withExt || 'workflow.json'
}

/** Create the workflows dir if missing and seed Default.json once. */
export async function ensureWorkflowsDir(workspace: string): Promise<void> {
  const dir = workflowsDir(workspace)
  await mkdir(dir, { recursive: true })
  const defaultPath = join(dir, 'Default.json')
  if (!existsSync(defaultPath)) {
    await writeFile(defaultPath, DEFAULT_WORKFLOW_JSON, 'utf-8')
  }
}

export async function listWorkflows(workspace: string): Promise<string[]> {
  await ensureWorkflowsDir(workspace)
  const entries = await readdir(workflowsDir(workspace), { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

export async function readWorkflow(workspace: string, name: string): Promise<string> {
  await ensureWorkflowsDir(workspace)
  const path = join(workflowsDir(workspace), sanitizeName(name))
  if (!existsSync(path)) {
    return readFile(join(workflowsDir(workspace), 'Default.json'), 'utf-8')
  }
  return readFile(path, 'utf-8')
}

export async function saveWorkflow(
  workspace: string,
  name: string,
  json: string
): Promise<string[]> {
  await ensureWorkflowsDir(workspace)
  const filename = sanitizeName(name)
  await writeFile(join(workflowsDir(workspace), filename), json, 'utf-8')
  return listWorkflows(workspace)
}

export async function deleteWorkflow(workspace: string, name: string): Promise<string[]> {
  const path = join(workflowsDir(workspace), sanitizeName(name))
  if (existsSync(path)) await unlink(path).catch(() => {})
  return listWorkflows(workspace)
}
