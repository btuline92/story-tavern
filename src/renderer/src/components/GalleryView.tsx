import { useCallback, useEffect, useState } from 'react'
import { useCharacters } from '../stores/characters'
import { useWorkspace } from '../stores/workspace'
import { askConfirm } from '../stores/dialog'
import type { GalleryAvatarSource, GalleryImage, StoryGalleryImage } from '../types'
import { AvatarThumb } from './AvatarThumb'
import { Lightbox } from './Lightbox'

type Selected = { src: string; title: string }

/** A lazy-loading gallery thumbnail. Reads dedicated images via gallery.read and
 *  story images via image.readFile; opens the lightbox on click. */
function GalleryThumb(
  props: (
    | { kind: 'dedicated'; characterId: string; file: string }
    | { kind: 'story'; storySlug: string; relPath: string }
  ) & {
    workspace: string
    title: string
    onOpen: (sel: Selected) => void
  }
): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  // Stable identity for the fetch effect (inline props change every render).
  const key =
    props.kind === 'dedicated'
      ? `d:${props.characterId}/${props.file}`
      : `s:${props.storySlug}/${props.relPath}`

  useEffect(() => {
    let cancelled = false
    const p =
      props.kind === 'dedicated'
        ? window.api.gallery.read(props.workspace, props.characterId, props.file)
        : window.api.image.readFile(props.workspace, props.storySlug, props.relPath)
    p.then((d) => {
      if (!cancelled) setSrc(d)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!src) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-ink-200 text-xs text-ink-700">
        Loading…
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      onClick={() => props.onOpen({ src, title: props.title })}
      className="aspect-square w-full cursor-zoom-in rounded-lg border border-ink-200 object-cover shadow-sm"
    />
  )
}

export function GalleryView(): React.JSX.Element {
  const workspace = useWorkspace((s) => s.path)!
  const { characters, load, setAvatarFromGallery } = useCharacters()
  // Seed from the characters store's selection so "Go to gallery…" lands on the right character.
  const [selectedId, setSelectedId] = useState<string | null>(() => useCharacters.getState().selectedId)
  const [dedicated, setDedicated] = useState<GalleryImage[]>([])
  const [stories, setStories] = useState<StoryGalleryImage[]>([])
  const [loading, setLoading] = useState(false)
  const [lightbox, setLightbox] = useState<Selected | null>(null)
  // Key of the image most recently set as the avatar, for a brief "✓ Set" confirmation.
  const [avatarSetKey, setAvatarSetKey] = useState<string | null>(null)

  useEffect(() => {
    load(workspace)
  }, [workspace, load])

  // Derive the active character without an effect — defaults to the first once loaded.
  const activeId = selectedId ?? characters[0]?.id ?? null

  const refresh = useCallback(async () => {
    if (!activeId) {
      setDedicated([])
      setStories([])
      return
    }
    setLoading(true)
    try {
      const res = await window.api.gallery.list(workspace, activeId)
      setDedicated(res.dedicated)
      setStories(res.stories)
    } finally {
      setLoading(false)
    }
  }, [workspace, activeId])

  useEffect(() => {
    // refresh() flips a loading flag synchronously; that's the intended fetch-on-select behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  const del = async (file: string): Promise<void> => {
    if (!activeId) return
    if (!(await askConfirm('Delete this picture from the gallery? This cannot be undone.'))) return
    await window.api.gallery.delete(workspace, activeId, file)
    await refresh()
  }

  // Set the shown character's avatar from a gallery/story image (all images shown belong to activeId).
  const setAvatar = async (key: string, source: GalleryAvatarSource): Promise<void> => {
    if (!activeId) return
    const updated = await setAvatarFromGallery(workspace, activeId, source)
    if (updated) {
      setAvatarSetKey(key)
      setTimeout(() => setAvatarSetKey((k) => (k === key ? null : k)), 1500)
    }
  }

  const activeName = characters.find((c) => c.id === activeId)?.name ?? 'this character'

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-ink-200 bg-ink-50">
        <div className="p-3 text-xs font-semibold uppercase tracking-wide text-ink-700">
          Characters
        </div>
        {characters.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-ink-700">No characters yet. Create one first.</div>
        ) : (
          <ul>
            {characters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-100 ${
                    c.id === activeId ? 'bg-ink-100' : ''
                  }`}
                >
                  <AvatarThumb workspace={workspace} avatar={c.avatar} name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink-900">{c.name}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="flex-1 overflow-y-auto p-6">
        {!activeId ? (
          <div className="text-sm text-ink-700">Select a character to see their gallery.</div>
        ) : (
          <>
            <section className="mb-8">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-700">
                Dedicated
              </h3>
              {dedicated.length === 0 ? (
                <div className="text-xs text-ink-700">
                  No saved pictures yet. Generate one in Photography and save it here.
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                  {dedicated.map((img) => (
                    <div key={img.file} className="group relative">
                      <GalleryThumb
                        kind="dedicated"
                        workspace={workspace}
                        characterId={activeId}
                        file={img.file}
                        title={img.prompt}
                        onOpen={setLightbox}
                      />
                      <button
                        type="button"
                        onClick={() => setAvatar(`d:${img.file}`, { kind: 'dedicated', file: img.file })}
                        title={`Set as ${activeName}'s avatar`}
                        className="absolute left-1 top-1 rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-900 opacity-0 shadow transition hover:bg-surface group-hover:opacity-100"
                      >
                        {avatarSetKey === `d:${img.file}` ? '✓ Set' : '★ Avatar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => del(img.file)}
                        title="Delete this picture"
                        className="absolute right-1 top-1 rounded-md bg-surface/90 px-2 py-1 text-xs text-danger opacity-0 shadow transition hover:bg-surface group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-700">
                From stories
              </h3>
              {stories.length === 0 ? (
                <div className="text-xs text-ink-700">
                  {loading ? 'Loading…' : 'No story pictures for this character yet.'}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                  {stories.map((img) => (
                    <div key={`${img.storySlug}/${img.relPath}`} className="group relative">
                      <GalleryThumb
                        kind="story"
                        workspace={workspace}
                        storySlug={img.storySlug}
                        relPath={img.relPath}
                        title={img.prompt}
                        onOpen={setLightbox}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAvatar(`s:${img.storySlug}/${img.relPath}`, {
                            kind: 'story',
                            storySlug: img.storySlug,
                            relPath: img.relPath
                          })
                        }
                        title={`Set as ${activeName}'s avatar`}
                        className="absolute left-1 top-1 rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-900 opacity-0 shadow transition hover:bg-surface group-hover:opacity-100"
                      >
                        {avatarSetKey === `s:${img.storySlug}/${img.relPath}` ? '✓ Set' : '★ Avatar'}
                      </button>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-lg bg-black/50 px-1.5 py-0.5 text-[10px] text-white/90">
                        {img.storyTitle}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {lightbox && (
        <Lightbox src={lightbox.src} title={lightbox.title} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
