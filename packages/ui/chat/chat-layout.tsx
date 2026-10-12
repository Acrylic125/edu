import type { ComponentProps, ReactNode } from "react"

import { cn } from "../utils"

export { ChatSessions } from "./chat-sessions"

export function ChatPanel({
  children,
  composer,
  alerts,
}: {
  children: ReactNode
  composer: ReactNode
  alerts?: ReactNode
}) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="absolute inset-0 min-h-0 overflow-hidden">{children}</div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center px-4">
        <div className="pointer-events-auto w-full max-w-3xl">
          {alerts}
          {composer}
        </div>
      </div>
    </div>
  )
}

export function ChatComposerLayout({
  newTopicMode = false,
  input,
  toolbar,
  attachments,
  alerts,
  overlay,
  className,
  ...props
}: Omit<ComponentProps<"form">, "children"> & {
  newTopicMode?: boolean
  input: ReactNode
  toolbar: ReactNode
  attachments?: ReactNode
  alerts?: ReactNode
  overlay?: ReactNode
}) {
  return (
    <form
      {...props}
      className={cn(
        "relative flex min-h-28 w-full flex-col rounded-[1.5rem] border border-border/70 bg-card shadow-sm",
        newTopicMode &&
          "min-h-44 rounded-[1.75rem] border-transparent bg-card p-2 shadow-none focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/20",
        className,
      )}
    >
      {overlay}
      {alerts}
      {attachments}
      <div className="relative min-h-16 flex-1">{input}</div>
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        {toolbar}
      </div>
    </form>
  )
}

export function ChatMessage({
  role,
  children,
  actions,
}: {
  role: "user" | "assistant"
  children: ReactNode
  actions?: ReactNode
}) {
  if (role === "user") {
    return (
      <div
        data-message-role="user"
        aria-label="Your message"
        className="group flex flex-col items-end py-3"
      >
        <div className="max-w-[90%] min-w-0 rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-relaxed text-secondary-foreground [overflow-wrap:anywhere]">
          {children}
        </div>
        {actions ? (
          <div className="mt-1 flex justify-end">{actions}</div>
        ) : null}
      </div>
    )
  }
  return (
    <div
      data-message-role="assistant"
      aria-label="EdU's message"
      className="group py-4"
    >
      {children}
    </div>
  )
}

export function ChatEmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-5 text-center text-sm leading-6 text-muted-foreground">
      Tell EdU what you want to learn, or add slides and tutorials below.
    </div>
  )
}

export function ChatConversation({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      role="log"
      aria-label="Conversation"
      {...props}
      className={cn(
        "h-full min-h-0 overflow-y-auto px-5 pt-4 pb-60",
        className,
      )}
    />
  )
}
