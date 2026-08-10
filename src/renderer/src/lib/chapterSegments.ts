/**
 * Shared parser for chapter prose. A chapter's content is plain text with inline image markers
 * (`![alt](src "title")`); this splits it into an alternating run of text and image segments, which
 * both the editor (ChapterDocument) and the reader (StoryReader) render. `parse`/`serialize` round-trip
 * the original string exactly (text segments keep their raw slices, newlines and all).
 */
export type Segment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'image'; id: string; alt: string; src: string; title: string }

/** Markdown image: `![alt](src "title")`. src may not contain spaces or `)`; title is optional. */
export const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

export function parse(value: string): Segment[] {
  const segs: Segment[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  IMAGE_RE.lastIndex = 0
  while ((m = IMAGE_RE.exec(value)) !== null) {
    segs.push({ kind: 'text', id: `t${i}`, text: value.slice(last, m.index) })
    segs.push({ kind: 'image', id: `i${i}`, alt: m[1], src: m[2], title: m[3] ?? '' })
    last = m.index + m[0].length
    i++
  }
  segs.push({ kind: 'text', id: `t${i}`, text: value.slice(last) })
  return segs
}

export function serialize(segs: Segment[]): string {
  return segs
    .map((s) =>
      s.kind === 'text' ? s.text : `![${s.alt}](${s.src}${s.title ? ` "${s.title}"` : ''})`
    )
    .join('')
}
