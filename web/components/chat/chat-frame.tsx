import type { ReactNode } from "react"

import { AccountMenu } from "@/components/ui/account-menu"
import { PlanDialog } from "@/components/chat/plan-dialog"
import type { ChatSession } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

type ChatFrameProps = {
  title?: string
  status?: string
  titleSlot?: ReactNode
  statusSlot?: ReactNode
  planSession?: ChatSession
  hideHeader?: boolean
  body: ReactNode
  composer?: ReactNode
}

export function ChatFrame({
  title = "Chat",
  status = "Connecting",
  titleSlot,
  statusSlot,
  planSession,
  hideHeader = false,
  body,
  composer,
}: ChatFrameProps) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      {hideHeader ? null : (
        <header className="h-12 shrink-0 border-b border-border px-3">
          <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h1 className="min-w-0 truncate text-sm font-medium">
                {titleSlot ?? title}
              </h1>
              <PlanDialog session={planSession ?? null} />
            </div>
            {statusSlot === undefined ? (
              <div className="shrink-0 text-xs">
                <span className="text-muted-foreground">{status}</span>
              </div>
            ) : (
              statusSlot
            )}
            <AccountMenu />
          </div>
        </header>
      )}

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
