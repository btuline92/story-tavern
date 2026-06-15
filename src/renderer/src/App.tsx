import { useEffect, useState } from 'react'
import { useWorkspace } from './stores/workspace'
import { useStories } from './stores/stories'
import { WorkspacePicker } from './components/WorkspacePicker'
import { CharacterList } from './components/CharacterList'
import { CharacterDetail } from './components/CharacterDetail'
import { Settings } from './components/Settings'
import { PresetsView } from './components/PresetsView'
import { StoriesView } from './components/StoriesView'
import { LogsView } from './components/LogsView'

type View = 'stories' | 'characters' | 'presets' | 'logs' | 'settings'

const TABS: { id: View; label: string }[] = [
  { id: 'stories', label: 'Stories' },
  { id: 'characters', label: 'Characters' },
  { id: 'presets', label: 'Presets' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' }
]

function App(): React.JSX.Element {
  const { status, path: workspace, init } = useWorkspace()
  const [view, setView] = useState<View>('stories')

  useEffect(() => {
    init()
  }, [init])

  // Wire generation stream events to the stories store.
  // Each handler catches its own errors so a thrown action can never leave the store
  // in a stuck state (generating=true with no way to recover).
  useEffect(() => {
    if (!workspace) return
    const offDelta = window.api.generation.onDelta((streamId, delta) => {
      try {
        useStories.getState()._onStreamDelta(streamId, delta)
      } catch (e) {
        console.error('Stream delta handler failed:', e)
      }
    })
    const offReasoning = window.api.generation.onReasoning((streamId, delta) => {
      try {
        useStories.getState()._onStreamReasoning(streamId, delta)
      } catch (e) {
        console.error('Stream reasoning handler failed:', e)
      }
    })
    const offDone = window.api.generation.onDone((streamId, fullText) => {
      useStories
        .getState()
        ._onStreamDone(workspace, streamId, fullText)
        .catch((e) => {
          console.error('Stream done handler failed:', e)
          useStories.setState({
            generating: false,
            generationStreamId: null,
            generationStartedAt: null,
            streamBuffer: '',
            pendingGenBefore: null,
            generationError: e instanceof Error ? e.message : String(e)
          })
        })
    })
    const offError = window.api.generation.onError((streamId, error) => {
      try {
        useStories.getState()._onStreamError(streamId, error)
      } catch (e) {
        console.error('Stream error handler failed:', e)
        useStories.setState({
          generating: false,
          generationStreamId: null,
          generationStartedAt: null,
          streamBuffer: ''
        })
      }
    })
    return () => {
      offDelta()
      offReasoning()
      offDone()
      offError()
    }
  }, [workspace])

  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-ink-700">Loading…</div>
  }

  if (status === 'needs-pick') {
    return <WorkspacePicker />
  }

  return (
    <div className="grid h-full grid-cols-[16rem_1fr] grid-rows-[3rem_1fr]">
      <header className="col-span-2 row-start-1 flex items-center justify-between border-b border-ink-200 bg-white px-4">
        <div className="font-semibold text-ink-900">Story Tavern</div>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === t.id ? 'bg-ink-100 text-ink-900' : 'text-ink-700 hover:bg-ink-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {view === 'characters' ? (
        <>
          <aside className="row-start-2 col-start-1 overflow-hidden">
            <CharacterList />
          </aside>
          <main className="row-start-2 col-start-2 overflow-hidden">
            <CharacterDetail />
          </main>
        </>
      ) : view === 'presets' ? (
        <main className="row-start-2 col-span-2 overflow-hidden">
          <PresetsView />
        </main>
      ) : view === 'stories' ? (
        <main className="row-start-2 col-span-2 overflow-hidden">
          <StoriesView />
        </main>
      ) : view === 'logs' ? (
        <main className="row-start-2 col-span-2 overflow-hidden">
          <LogsView />
        </main>
      ) : (
        <main className="row-start-2 col-span-2 overflow-hidden">
          <Settings />
        </main>
      )}
    </div>
  )
}

export default App
