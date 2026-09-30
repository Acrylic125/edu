"use client"

export default function ChatError({ reset }: { reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">Could not load this chat</h2>
      <p className="text-sm text-muted-foreground">Please try again.</p>
      <button type="button" onClick={reset} className="rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>
    </div>
  )
}
