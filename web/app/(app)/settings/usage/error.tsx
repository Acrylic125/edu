"use client"

export default function UsageError({
  reset,
}: {
  reset: () => void
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-5">
      <h2 className="font-medium">Usage data is unavailable</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start the API worker, then retry this page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
      >
        Try again
      </button>
    </div>
  )
}
