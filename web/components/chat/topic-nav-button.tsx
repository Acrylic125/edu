"use client"

import { useSwitchTopic } from "@/components/chat/use-switch-topic"
import type { TopicHandoff } from "@/lib/chat/types"
import { cn } from "@/lib/utils"

export function TopicNavButton({
  target,
  className,
}: {
  target: TopicHandoff
  className?: string
}) {
  const switchTopic = useSwitchTopic()

  return (
    <div className={cn("mx-auto w-full max-w-3xl px-4", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-center rounded-md border border-border bg-transparent px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted/40"
        onClick={() => {
          void switchTopic(target.topicId)
        }}
      >
        <span className="truncate">{`Go to ${target.title}`}</span>
      </button>
    </div>
  )
}
