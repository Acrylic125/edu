"use client"

import { useState, type ComponentProps, type ReactNode } from "react"
import { CheckIcon, CopyIcon, type LucideIcon } from "lucide-react"

import { Button } from "../primitives/button"
import { ScrollArea } from "../primitives/scroll-area"

import { cn } from "../utils"

export { ChatSessions, restoreChatFocus } from "./chat-sessions"

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
  newScratchpadMode = false,
  input,
  toolbar,
  attachments,
  alerts,
  overlay,
  className,
  ...props
}: Omit<ComponentProps<"form">, "children"> & {
  newScratchpadMode?: boolean
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
        !newScratchpadMode && "bg-input/25 shadow-lg backdrop-blur-xl",
        newScratchpadMode &&
          "min-h-44 rounded-[1.75rem] border-input bg-muted p-2 shadow-sm focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20",
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
  copyText,
  onCopy,
  durationMs,
}: {
  role: "user" | "assistant"
  children: ReactNode
  actions?: ReactNode
  copyText?: string
  durationMs?: number
  onCopy?: (text: string) => Promise<void>
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle")
  let copyLabel = "Copy message"
  if (copyStatus === "copied") {
    copyLabel = "Copied"
  } else if (copyStatus === "error") {
    copyLabel = "Couldn't copy. Try again"
  }

  const messageActions = (copyText || actions || durationMs !== undefined) && (
    <div className={cn("mt-1 flex h-7 items-center justify-between gap-2", role === "assistant" && "self-stretch")}>
      <div className="flex h-full items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
        {copyText && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copyLabel}
            title={copyLabel}
            className="text-muted-foreground"
            onClick={async () => {
              try {
                if (onCopy) {
                  await onCopy(copyText)
                } else {
                  await navigator.clipboard.writeText(copyText)
                }
                setCopyStatus("copied")
              } catch {
                setCopyStatus("error")
              }
            }}
          >
            {copyStatus === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        )}
        <span role="status" className="text-xs text-muted-foreground">
          {copyStatus !== "idle" && copyLabel}
        </span>
        {actions}
      </div>
      {role === "assistant" && durationMs !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label="Response duration">
          {(durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  )

  if (role === "user") {
    return (
      <div
        data-message-role="user"
        aria-label="Your message"
        className="group flex flex-col items-end"
        onMouseLeave={() => setCopyStatus("idle")}
      >
        <div className="max-w-[90%] min-w-0 rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-sm leading-relaxed text-secondary-foreground [overflow-wrap:anywhere]">
          {children}
        </div>
        {messageActions}
      </div>
    )
  }
  return (
    <div
      data-message-role="assistant"
      aria-label="EdU's message"
      className="group"
      onMouseLeave={() => setCopyStatus("idle")}
    >
      {children}
      {messageActions}
    </div>
  )
}

export function ChatThinking({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <div role="status" className={cn("py-4 text-sm", className)}>
      <span className="chat-thinking-scan">{children || "Thinking…"}</span>
    </div>
  )
}

export function ChatEmptyState({
  newScratchpad = false,
  title,
  description = "Start with a question, or attach your slides and notes below.",
  suggestions = [],
  onPrompt,
}: {
  newScratchpad?: boolean
  title?: string
  description?: string
  suggestions?: { label: string; prompt: string; icon: LucideIcon }[]
  onPrompt?: (prompt: string) => void
}) {
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <h2 className="max-w-64 text-2xl font-semibold leading-tight tracking-tight">
          {title ?? (newScratchpad ? "What would you like to learn?" : "Ask about this lesson")}
        </h2>
        <p className="mt-3 max-w-64 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {onPrompt && suggestions.length > 0 && (
          <div className="mt-6 flex w-full max-w-64 flex-col gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.label}
                variant="plain"
                size="auto"
                className="flex items-center gap-3 rounded-xl border border-sidebar-border px-4 py-3 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onPrompt(suggestion.prompt)}
              >
                <suggestion.icon className="size-4 shrink-0" aria-hidden="true" />
                {suggestion.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

export function ChatConversation({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <ScrollArea
      className="h-full min-h-0"
      viewportProps={{
        role: "log",
        "aria-label": "Conversation",
        ...props,
        className: cn("px-5 pt-4 pb-60", className),
      }}
    >
      {children}
    </ScrollArea>
  )
}
