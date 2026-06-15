import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type KeyMap = Record<string, string>

function keysFilePath(): string {
  return join(app.getPath('userData'), 'keys.bin')
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

async function readKeyMap(): Promise<KeyMap> {
  const path = keysFilePath()
  if (!existsSync(path)) return {}
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (DPAPI/Keychain/libsecret) is not available')
  }
  const buf = await readFile(path)
  if (buf.length === 0) return {}
  const decrypted = safeStorage.decryptString(buf)
  try {
    return JSON.parse(decrypted) as KeyMap
  } catch {
    return {}
  }
}

async function writeKeyMap(map: KeyMap): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (DPAPI/Keychain/libsecret) is not available')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(map))
  await writeFile(keysFilePath(), encrypted)
}

export async function getKey(provider: string): Promise<string | null> {
  const map = await readKeyMap()
  return map[provider] ?? null
}

export async function setKey(provider: string, key: string): Promise<void> {
  const map = await readKeyMap()
  map[provider] = key
  await writeKeyMap(map)
}

export async function deleteKey(provider: string): Promise<void> {
  const map = await readKeyMap()
  delete map[provider]
  await writeKeyMap(map)
}

interface AppState {
  lastWorkspace?: string
}

export async function readState(): Promise<AppState> {
  const path = stateFilePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as AppState
  } catch {
    return {}
  }
}

export async function writeState(state: AppState): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(stateFilePath(), JSON.stringify(state, null, 2), 'utf-8')
}
