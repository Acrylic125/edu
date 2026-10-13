"use client"

import type { ComponentProps, ReactNode } from "react"
import { BookOpenIcon, MessageCircleIcon, PencilLineIcon } from "lucide-react"

import { Button } from "../primitives/button"
import { ScrollArea } from "../primitives/scroll-area"

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <div className="flex shrink-0 flex-col items-center px-4 pb-4 pt-3">
        <div className="w-full max-w-3xl">
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

export function ChatEmptyState({
  newTopic = false,
  title,
  description = "Start with a question, or attach your slides and notes below.",
  onPrompt,
}: {
  newTopic?: boolean
  title?: string
  description?: string
  onPrompt?: (prompt: string) => void
}) {
  const suggestions = [
    {
      label: "Explain a concept",
      icon: BookOpenIcon,
      prompt: newTopic
        ? "Help me understand derivatives with a simple example."
        : "Explain the current topic with a simple example.",
    },
    {
      label: "Help me practice",
      icon: PencilLineIcon,
      prompt: newTopic
        ? "Help me prepare for my exam."
        : "Give me a practice question on the current topic.",
    },
  ]

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-learning-sage text-learning-ink">
          <MessageCircleIcon className="size-6" aria-hidden="true" />
        </span>
        <h2 className="max-w-64 text-2xl font-semibold leading-tight tracking-tight">
          {title ?? (newTopic ? "What would you like to learn?" : "Ask about this lesson")}
        </h2>
        <p className="mt-3 max-w-64 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {onPrompt && (
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
        className: cn("px-5 pt-4 pb-6", className),
      }}
    >
      {children}
    </ScrollArea>
  )
}
