import { readFile } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export interface TavernV2Data {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  character_book: Record<string, unknown> | null
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
}

export interface TavernCard {
  spec: 'chara_card_v2' | 'chara_card_v3' | 'unknown'
  spec_version: string
  data: TavernV2Data
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
  )
}

function* iterateTextChunks(bytes: Uint8Array): Generator<{ keyword: string; value: string }> {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file')
  }
  let offset = 8
  while (offset < bytes.length) {
    const length = readUInt32BE(bytes, offset) >>> 0
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    )
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const nullIdx = data.indexOf(0)
      if (nullIdx > 0) {
        const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx))
        const value = new TextDecoder('latin1').decode(data.subarray(nullIdx + 1))
        yield { keyword, value }
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4 // skip CRC
  }
}

function normalize(raw: Partial<TavernV2Data> | undefined): TavernV2Data {
  const r = raw ?? {}
  return {
    name: typeof r.name === 'string' ? r.name : '',
    description: typeof r.description === 'string' ? r.description : '',
    personality: typeof r.personality === 'string' ? r.personality : '',
    scenario: typeof r.scenario === 'string' ? r.scenario : '',
    first_mes: typeof r.first_mes === 'string' ? r.first_mes : '',
    mes_example: typeof r.mes_example === 'string' ? r.mes_example : '',
    creator_notes: typeof r.creator_notes === 'string' ? r.creator_notes : '',
    system_prompt: typeof r.system_prompt === 'string' ? r.system_prompt : '',
    post_history_instructions:
      typeof r.post_history_instructions === 'string' ? r.post_history_instructions : '',
    alternate_greetings: Array.isArray(r.alternate_greetings) ? r.alternate_greetings : [],
    character_book:
      r.character_book && typeof r.character_book === 'object' ? r.character_book : null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    creator: typeof r.creator === 'string' ? r.creator : '',
    character_version: typeof r.character_version === 'string' ? r.character_version : '',
    extensions: r.extensions && typeof r.extensions === 'object' ? r.extensions : {}
  }
}

function parseEnvelope(json: unknown): TavernCard {
  if (typeof json !== 'object' || json === null) throw new Error('card JSON is not an object')
  const env = json as { spec?: string; spec_version?: string; data?: Partial<TavernV2Data> }
  const spec =
    env.spec === 'chara_card_v3'
      ? 'chara_card_v3'
      : env.spec === 'chara_card_v2'
        ? 'chara_card_v2'
        : 'unknown'
  return {
    spec,
    spec_version: typeof env.spec_version === 'string' ? env.spec_version : '',
    data: normalize(env.data ?? (env as unknown as Partial<TavernV2Data>))
  }
}

export async function parseCardFromPng(path: string): Promise<TavernCard> {
  const buf = await readFile(path)
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  let v2: string | null = null
  let v3: string | null = null
  for (const { keyword, value } of iterateTextChunks(bytes)) {
    if (keyword === 'ccv3') v3 = value
    else if (keyword === 'chara') v2 = value
  }
  const encoded = v3 ?? v2
  if (!encoded) throw new Error('No character data chunk (ccv3 or chara) found in PNG')
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
  return parseEnvelope(JSON.parse(decoded))
}

// --- PNG writer (for in-app character export) ---

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const body = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crcBuf])
}

function makePlaceholderImage(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8
  ihdrData[9] = 2 // RGB
  const ihdr = pngChunk('IHDR', ihdrData)
  const rowLen = 1 + width * 3
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    const base = y * rowLen
    raw[base] = 0
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = rgb[0]
      raw[base + 2 + x * 3] = rgb[1]
      raw[base + 3 + x * 3] = rgb[2]
    }
  }
  const idat = pngChunk('IDAT', deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, ihdr, idat, iend])
}

function stripTextChunks(png: Buffer, keywords: Set<string>): Buffer {
  const signature = png.subarray(0, 8)
  const out: Buffer[] = [signature]
  let off = 8
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString('latin1', off + 4, off + 8)
    const chunkEnd = off + 12 + len
    if (type === 'tEXt') {
      const data = png.subarray(off + 8, off + 8 + len)
      const nul = data.indexOf(0)
      const keyword = nul > 0 ? data.subarray(0, nul).toString('latin1') : ''
      if (!keywords.has(keyword)) out.push(png.subarray(off, chunkEnd))
    } else {
      out.push(png.subarray(off, chunkEnd))
    }
    if (type === 'IEND') break
    off = chunkEnd
  }
  return Buffer.concat(out)
}

function insertTextChunkBeforeIend(png: Buffer, keyword: string, value: string): Buffer {
  const kw = Buffer.from(keyword, 'latin1')
  const val = Buffer.from(value, 'latin1')
  const textChunk = pngChunk('tEXt', Buffer.concat([kw, Buffer.from([0]), val]))
  // Find IEND chunk start
  let off = 8
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString('latin1', off + 4, off + 8)
    if (type === 'IEND') {
      return Buffer.concat([png.subarray(0, off), textChunk, png.subarray(off)])
    }
    off += 12 + len
  }
  throw new Error('PNG missing IEND')
}

export interface BuildCardOptions {
  data: TavernV2Data
  /** Existing avatar PNG bytes; if omitted, a placeholder is generated. */
  avatarPng?: Buffer | null
}

export function buildTavernCardPng({ data, avatarPng }: BuildCardOptions): Buffer {
  const base = avatarPng
    ? stripTextChunks(avatarPng, new Set(['chara', 'ccv3']))
    : makePlaceholderImage(128, 128, [120, 90, 60])
  const envelope = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data
  }
  const b64 = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64')
  return insertTextChunkBeforeIend(base, 'chara', b64)
}

export function parseCardFromJson(text: string): TavernCard {
  const parsed = JSON.parse(text)
  // Some JSON exports are bare `data` objects; wrap if so.
  if (
    parsed &&
    typeof parsed === 'object' &&
    !('spec' in parsed) &&
    !('data' in parsed) &&
    'name' in parsed
  ) {
    return parseEnvelope({ spec: 'chara_card_v2', spec_version: '2.0', data: parsed })
  }
  return parseEnvelope(parsed)
}
