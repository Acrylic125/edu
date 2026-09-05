"use client"

import { useSwitchTopic } from "@/components/chat/use-switch-topic"
import type { TopicHandoff } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

export function TopicNavButton({
  target,
  direction,
  className,
}: {
  target: TopicHandoff
  direction: "previous" | "next"
  className?: string
}) {
  const switchTopic = useSwitchTopic()
  const summary = target.summary.trim()
  const gradientClass =
    direction === "previous"
      ? "bg-gradient-to-b from-background/10 via-background/75 to-background"
      : "bg-gradient-to-t from-background via-background/75 to-background/10"

  return (
    <div
      className={cn(
        "relative mx-auto flex h-28 max-h-28 w-full max-w-3xl items-center overflow-hidden px-4",
        className
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-6 inset-y-2 overflow-hidden rounded-lg border border-border/60 bg-muted/20 px-5 py-3 text-sm text-muted-foreground"
      >
        <p className="truncate font-medium text-foreground/70">{target.title}</p>
        <p className="mt-1 line-clamp-3 leading-relaxed">
          {summary || "No summary available yet."}
        </p>
      </div>
      <div className={cn("pointer-events-none absolute inset-0", gradientClass)} />
      <button
        type="button"
        className="relative z-10 mx-auto flex max-w-[min(24rem,85%)] items-center justify-center rounded-full border border-border bg-card/95 px-5 py-2.5 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-[background-color,transform] hover:scale-[1.02] hover:bg-muted active:scale-[0.98]"
        onClick={() => {
          void switchTopic(target.topicId)
        }}
      >
        <span className="truncate">{`Go to ${target.title}`}</span>
      </button>
    </div>
  )
}
