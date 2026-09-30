"use client"

import { MessageList } from "@/components/chat/message-list"
import { selectShellPhase, useChatStore } from "@/lib/chat/store"

export function ChatThreadIsland({
  onOption,
  onDecision,
}: {
  onOption: (messageId: string, label: string) => void
  onDecision: (proposalId: string, decision: "accept" | "reject") => void
}) {
  const phase = useChatStore(selectShellPhase)
  const optionState = useChatStore((state) => state.optionState)
  const currentStepId = useChatStore((state) =>
    state.session.kind === "topic" ? state.session.currentStepId ?? null : null,
  )

  if (phase.show !== "thread") {
    return null
  }

  if (phase.empty) return null

  const visibleMessages = phase.messages.filter((message) => {
    if (message.role !== "user") return true
    const text = message.parts.find((part) => part.type === "text")
    return text?.type !== "text" || !/^\/new(?:\s|$)/i.test(text.content)
  })

  return (
    <div key={phase.topicId} className="h-full min-h-0">
      <MessageList
        messages={visibleMessages}
        optionState={optionState}
        currentStepId={currentStepId}
        onOption={onOption}
        onDecision={onDecision}
      />
    </div>
  )
}
