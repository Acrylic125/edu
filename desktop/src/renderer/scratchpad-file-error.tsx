import { AlertTriangle, RotateCcw } from "lucide-react"
import type { Snapshot } from "../shared/contracts"

export function ScratchpadFileError({ error, busy, onRegenerate, onConvert }: {
  error: NonNullable<Snapshot["scratchpads"][number]["fileError"]>
  busy: boolean
  onRegenerate: () => void
  onConvert: () => void
}) {
  return (
    <div role="alert" className="mb-6 rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-3">
          {error === "missing-markdown" && (
            <>
              <p className="font-medium text-destructive">ERROR! Missing scratchpad.md</p>
              <button type="button" disabled={busy} onClick={onRegenerate} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
                <RotateCcw aria-hidden="true" className="size-3.5" />
                Regenerate
              </button>
            </>
          )}
          {error === "missing-state" && (
            <>
              <p>Scratchpad state file is missing. We cannot recover this. Convert to Generic Scratchpad?</p>
              <button type="button" disabled={busy} onClick={onConvert} className="rounded-lg border border-border bg-background px-3 py-2 font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
                Convert to generic scratchpad
              </button>
            </>
          )}
          {error === "missing-both" && (
            <>
              <p className="font-medium text-destructive">Missing scratchpad.md</p>
              <p>Cannot reconcile scratchpad, missing scratchpad.state.json</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
