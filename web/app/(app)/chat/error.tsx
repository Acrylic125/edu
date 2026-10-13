"use client"

import { Button } from "@/components/ui/button"

export default function ChatError({ reset }: { reset: () => void }) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">Could not load this chat</h2>
      <p className="text-sm text-muted-foreground">Please try again.</p>
      <Button variant="secondary" size="auto" type="button" onClick={reset} className="rounded-md border-0 px-4 py-2">Retry</Button>
    </div>
  )
}
