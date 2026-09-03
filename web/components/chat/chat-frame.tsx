import type { ReactNode } from "react"

import { AccountMenu } from "@/components/ui/account-menu"
import { cn } from "@/lib/utils"

type ChatFrameProps = {
  title?: string
  status?: string
  titleSlot?: ReactNode
  statusSlot?: ReactNode
  body: ReactNode
  composer?: ReactNode
}

export function ChatFrame({
  title = "Chat",
  status = "Connecting",
  titleSlot,
  statusSlot,
  body,
  composer,
}: ChatFrameProps) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {titleSlot ?? title}
        </h1>
        <div className="shrink-0 text-xs">
          {statusSlot ?? (
            <span className="text-muted-foreground">{status}</span>
          )}
        </div>
        <AccountMenu />
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {body}
        {composer}
      </div>
    </div>
  )
}

export function ChatFrameStatus({
  label,
  tone,
}: {
  label: string
  tone: "muted" | "destructive"
}) {
  return (
    <p
      className={cn(
        "text-xs",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {label}
    </p>
  )
}
