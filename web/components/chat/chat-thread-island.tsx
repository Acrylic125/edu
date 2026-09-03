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

  if (phase.show !== "thread") {
    return null
  }

  const previous = resolvePreviousTopic(catalog, phase.topicId)
  const next = resolveNextTopic(catalog, phase.topicId)
  const header =
    previous !== null ? (
      <TopicNavButton target={previous} className="pt-3 pb-1" />
    ) : null
  const footer =
    next !== null ? (
      <TopicNavButton target={next} className="pt-1 pb-2" />
    ) : null

  if (phase.empty && header === null && footer === null) {
    return null
  }

  return (
    <MessageList
      messages={phase.messages}
      header={header}
      footer={footer}
      onOption={onOption}
      onDecision={onDecision}
    />
  )
}
