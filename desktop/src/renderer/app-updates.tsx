import { create } from "zustand"
import type { z } from "zod"
import type { AppUpdateSchema } from "../shared/app-updates"
import { desktop, desktopErrorMessage } from "./store"

export const useAppUpdates = create<{
  update: z.infer<typeof AppUpdateSchema>
}>()(() => ({ update: { version: "", enabled: false, phase: "idle" } }))

export async function initializeAppUpdates() {
  if (!window.edu) return
  let changed = false
  window.edu.subscribeAppUpdates((update) => {
    changed = true
    useAppUpdates.setState({ update })
  })
  try {
    const update = await window.edu.appUpdateState()
    if (!changed) useAppUpdates.setState({ update })
  } catch (error) {
    useAppUpdates.setState((state) => ({ update: { ...state.update, error: error instanceof Error ? desktopErrorMessage(error) : "Could not load update status." } }))
  }
}

export function AppUpdateControl() {
  const { version, enabled, phase, latestVersion, progress, checkedAt, error } = useAppUpdates((state) => state.update)
  let label = "Check"
  let description = "Check for updates"
  let disabled = !enabled
  if (!enabled) description = "Updates are available in installed releases."
  if (phase === "checking") {
    label = "Checking…"
    disabled = true
  } else if (phase === "available") {
    label = "Update"
    description = `Download version ${latestVersion}`
  } else if (phase === "downloading") {
    label = `Updating ${Math.floor(progress ?? 0)}%`
    disabled = true
  } else if (phase === "downloaded") {
    label = "Restart"
    description = `Restart and install version ${latestVersion}`
  } else if (phase === "installing") {
    label = "Restarting…"
    disabled = true
  } else if (checkedAt && !error) {
    description = `Up to date. Last checked ${new Date(checkedAt).toLocaleTimeString()}`
  }

  async function act() {
    try {
      // State arrives through the subscription so an older response cannot overwrite progress.
      if (phase === "available" || phase === "downloaded") await desktop().installAppUpdate()
      else await desktop().checkAppUpdate()
    } catch (error) {
      useAppUpdates.setState((state) => ({ update: { ...state.update, error: error instanceof Error ? desktopErrorMessage(error) : "Could not update EdU." } }))
    }
  }

  return (
    <div className="min-w-0 flex-1 text-xs text-muted-foreground" aria-label="App updates">
      <div className="flex min-h-9 items-center gap-2">
        <span className="truncate tabular-nums" title={version ? `EdU ${version}` : "Development build"}>{version ? `v${version}` : "Development"}</span>
        <button
          type="button"
          className="shrink-0 rounded-full px-2.5 py-1.5 font-medium hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-60"
          disabled={disabled}
          title={description}
          aria-label={description}
          onClick={() => void act()}
        >
          {label}
        </button>
      </div>
      {error && <p role="alert" title={error} className="line-clamp-2 max-w-full break-words pb-1 text-destructive">{error}</p>}
      {phase === "idle" && checkedAt && !error && <p role="status" className="pb-1">Up to date</p>}
      {(phase === "downloading" || phase === "downloaded") && <span role="status" className="sr-only">{label}</span>}
    </div>
  )
}
