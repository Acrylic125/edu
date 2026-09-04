"use client"

import { MessageList } from "@/components/chat/message-list"
import { TopicNavButton } from "@/components/chat/topic-nav-button"
import { resolveNextTopic, resolvePreviousTopic } from "@/lib/chat/catalog"
import { selectShellPhase, useChatStore } from "@/lib/chat/store"

export function ChatThreadIsland({
  onOption,
  onDecision,
}: {
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  const phase = useChatStore(selectShellPhase)
  const catalog = useChatStore((state) => state.catalog)
  const topicEntry = useChatStore((state) => state.topicEntry)

  if (phase.show !== "thread") {
    return null
  }

  const previous = resolvePreviousTopic(catalog, phase.topicId)
  const next = resolveNextTopic(catalog, phase.topicId)
  const header =
    previous !== null ? (
      <TopicNavButton target={previous} direction="previous" />
    ) : null
  const footer =
    next !== null ? (
      <TopicNavButton target={next} direction="next" />
    ) : null

  if (phase.empty && header === null && footer === null) {
    return null
  }

  let entryClassName = ""
  if (topicEntry?.topicId === phase.topicId) {
    entryClassName =
      topicEntry.direction === "up"
        ? "animate-[topic-enter-from-top_360ms_cubic-bezier(0.22,1,0.36,1)]"
        : "animate-[topic-enter-from-bottom_360ms_cubic-bezier(0.22,1,0.36,1)]"
  }

  return (
    <div key={phase.topicId} className={`h-full min-h-0 ${entryClassName}`}>
      <MessageList
        messages={phase.messages}
        header={header}
        footer={footer}
        onOption={onOption}
        onDecision={onDecision}
      />
    </div>
  )
}
