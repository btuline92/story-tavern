import { useWorkspace } from '../stores/workspace'

export function WorkspacePicker(): React.JSX.Element {
  const pick = useWorkspace((s) => s.pick)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-12 text-center">
      <h1 className="text-3xl font-semibold text-ink-900">Story Tavern</h1>
      <p className="max-w-md text-ink-700">
        Pick a folder to use as your workspace. Characters, settings, and (eventually) stories will
        live there as plain markdown files you can read, edit, and back up however you like.
      </p>
      <button
        type="button"
        onClick={() => pick()}
        className="rounded-md bg-accent-500 px-6 py-3 text-white font-medium shadow-sm hover:bg-accent-600 transition"
      >
        Choose workspace folder…
      </button>
    </div>
  )
}
