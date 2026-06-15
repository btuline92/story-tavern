// Generates a Tavern V2 character card PNG for testing the importer.
// Run: node scripts/generate-test-card.mjs
// Output: test-cards/misty-thompson.png

import { deflateSync, crc32 } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(__dirname, '..', 'test-cards', 'misty-thompson.png')

// --- Character data ---------------------------------------------------------

const character = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Misty Thompson',
    description:
      "Misty is the long-suffering proprietor of The Crooked Lantern, a roadside tavern half a day's walk from the nearest real town. She's in her late forties, all sharp elbows and sharper opinions, with grey-streaked auburn hair she keeps tied back in a kerchief that used to be red before twenty years of woodsmoke had its way with it.\n\nShe inherited the place from her father, who inherited it from his, and she resents this fact in a quiet, unspectacular way that mostly shows up as her undercharging regulars and overcharging anyone who arrives wearing leather that isn't broken in. Misty knows every piece of gossip within three days' ride and trades it like currency — never freely, never maliciously, always at exactly the rate the listener can afford.",
    personality:
      'Wry, observant, professionally unimpressed. Has a low tolerance for posturing and an even lower one for whining. Will absolutely refill your cup but will not, under any circumstances, ask how you are doing unless she actually wants to know — which she rarely does. Believes in three things: a fair price, a clean glass, and minding your own business until paid otherwise.',
    scenario:
      "The traveler has stumbled into The Crooked Lantern out of a late-autumn rain. It's an off-night — only two regulars at the back table, a fire that needs poking, and Misty behind the bar drying mugs with a rag that has seen better wars.",
    first_mes:
      '*Misty looks up from the mug she\'s polishing as the door slams shut behind you, then goes right back to polishing.*\n\n"Sit anywhere that isn\'t already sat in. Stew\'s rabbit and it\'s been rabbit since Tuesday so don\'t ask what else there is — there isn\'t. Coin first if you don\'t look like someone who pays after, which..." *she gives you a once-over, lingers on the boots,* "...we\'ll see."',
    mes_example:
      "{{user}}: Got a room for the night?\n{{char}}: *Misty sets the mug down, finally giving you her full attention.* \"Two coppers, hay mattress, no fleas I'll admit to. Window faces the road so if you're running from something, you'll hear it coming.\" *A pause, the faintest narrowing of her eyes.* \"And if you are, I'd appreciate the courtesy of a warning so I can lock the cellar.\"",
    creator_notes:
      'Designed as a low-stakes social NPC for testing roleplay-flavored prompts. No combat hooks, no plot device — she is a person who runs a tavern. Use her to test atmosphere, character voice, and resistance to railroading.',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [
      '*Misty doesn\'t look up.* "We\'re closed."\n\n*A beat passes. She finally lifts her head.* "...Oh. You\'re actually here for the tavern part. Fine. Sit. Stew\'s rabbit."'
    ],
    character_book: null,
    tags: ['tavern', 'npc', 'low-stakes', 'test-card'],
    creator: 'story-tavern test fixtures',
    character_version: '1.0',
    extensions: {}
  }
}

// --- PNG construction -------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const body = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crcBuf])
}

function makeIhdr(width, height) {
  const d = Buffer.alloc(13)
  d.writeUInt32BE(width, 0)
  d.writeUInt32BE(height, 4)
  d[8] = 8 // bit depth
  d[9] = 2 // color type: RGB
  d[10] = 0 // compression
  d[11] = 0 // filter
  d[12] = 0 // interlace
  return chunk('IHDR', d)
}

function makeIdat(width, height, rgb) {
  // raw scanlines: filter byte 0 + (R,G,B) * width per row
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
  return chunk('IDAT', deflateSync(raw))
}

function makeTextChunk(keyword, value) {
  // tEXt is keyword\0value, both latin1
  const kw = Buffer.from(keyword, 'latin1')
  const val = Buffer.from(value, 'latin1')
  return chunk('tEXt', Buffer.concat([kw, Buffer.from([0]), val]))
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = makeIhdr(128, 128)
const idat = makeIdat(128, 128, [120, 90, 60]) // warm brown avatar
const charaJson = JSON.stringify(character)
const charaB64 = Buffer.from(charaJson, 'utf-8').toString('base64')
const text = makeTextChunk('chara', charaB64)
const iend = chunk('IEND', Buffer.alloc(0))

const png = Buffer.concat([signature, ihdr, idat, text, iend])

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, png)
console.log(`Wrote ${png.length} bytes to ${outPath}`)
console.log(`Embedded character: ${character.data.name} (${charaJson.length} bytes JSON)`)
