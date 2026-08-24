"use client"

import { Button } from "@/components/ui/button"
import { selectShellPhase, useChatStore } from "@/lib/chat/store"
import { useSwitchTopic } from "@/components/chat/use-switch-topic"

export function PreviousTopicBar() {
  const phase = useChatStore(selectShellPhase)
  const switchTopic = useSwitchTopic()

  if (phase.show !== "thread" || phase.handoff === null) {
    return null
  }

  const title = phase.handoff.title
  const topicId = phase.handoff.topicId

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="max-w-full shadow-sm"
        onClick={() => {
          void switchTopic(topicId)
        }}
      >
        <span className="truncate">
          {`Change to Previous Topic, "${title}"`}
        </span>
      </Button>
    </div>
  )
}
