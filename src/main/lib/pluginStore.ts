import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from 'ulid'

/**
 * A "plugin" is a reusable, named decorator appended to the system prompt to emphasize a
 * certain kind of content — kept separate from presets so presets stay generic. Stored per
 * workspace in plugins.json; selected per story (story.meta.plugin_ids).
 */
export interface Plugin {
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

interface PluginsFile {
  plugins: Plugin[]
}

function pluginsPath(workspace: string): string {
  return join(workspace, 'plugins.json')
}

function isPlugin(p: unknown): p is Plugin {
  return (
    !!p &&
    typeof (p as Plugin).id === 'string' &&
    typeof (p as Plugin).name === 'string' &&
    typeof (p as Plugin).content === 'string'
  )
}

async function readData(workspace: string): Promise<PluginsFile> {
  const path = pluginsPath(workspace)
  if (!existsSync(path)) return { plugins: [] }
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as { plugins?: unknown }
    const plugins = Array.isArray(raw.plugins) ? raw.plugins.filter(isPlugin) : []
    return { plugins }
  } catch {
    return { plugins: [] }
  }
}

async function writeData(workspace: string, data: PluginsFile): Promise<void> {
  await writeFile(pluginsPath(workspace), JSON.stringify(data, null, 2), 'utf-8')
}

export async function listPlugins(workspace: string): Promise<Plugin[]> {
  const { plugins } = await readData(workspace)
  return plugins.slice().sort((a, b) => a.name.localeCompare(b.name))
}

export async function getPlugin(workspace: string, id: string): Promise<Plugin | null> {
  const { plugins } = await readData(workspace)
  return plugins.find((p) => p.id === id) ?? null
}

/** Return the given plugins in id order (missing ids skipped) — used at generation time. */
export async function getPluginsByIds(workspace: string, ids: string[]): Promise<Plugin[]> {
  if (!ids || ids.length === 0) return []
  const { plugins } = await readData(workspace)
  const byId = new Map(plugins.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is Plugin => p != null)
}

export async function createPlugin(workspace: string, name: string): Promise<Plugin> {
  const data = await readData(workspace)
  const now = new Date().toISOString()
  const plugin: Plugin = {
    id: ulid(),
    name: name.trim() || 'Untitled plugin',
    content: '',
    created_at: now,
    updated_at: now
  }
  data.plugins.push(plugin)
  await writeData(workspace, data)
  return plugin
}

export async function savePlugin(workspace: string, plugin: Plugin): Promise<Plugin> {
  const data = await readData(workspace)
  const updated: Plugin = {
    ...plugin,
    name: plugin.name.trim() || 'Untitled plugin',
    updated_at: new Date().toISOString()
  }
  const idx = data.plugins.findIndex((p) => p.id === plugin.id)
  if (idx >= 0) data.plugins[idx] = updated
  else data.plugins.push(updated)
  await writeData(workspace, data)
  return updated
}

export async function deletePlugin(workspace: string, id: string): Promise<void> {
  const data = await readData(workspace)
  data.plugins = data.plugins.filter((p) => p.id !== id)
  await writeData(workspace, data)
}
