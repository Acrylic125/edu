"use client"

import { MessageList } from "@/components/chat/message-list"
import { selectShellPhase, useChatStore } from "@/lib/chat/store"

export function ChatThreadIsland({
  onOption,
  onDecision,
}: {
  onOption: (label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  const phase = useChatStore(selectShellPhase)

  if (phase.show !== "thread" || phase.empty) {
    return null
  }

  return (
    <MessageList
      messages={phase.messages}
      onOption={onOption}
      onDecision={onDecision}
    />
  )
}
