import { Suspense } from "react"

import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { loadCurrentChatSnapshot } from "@/lib/chat/load-topic-snapshot"

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          Loading chat…
        </div>
      }
    >
      <CurrentTopicChat />
    </Suspense>
  )
}

async function CurrentTopicChat() {
  const snapshot = await loadCurrentChatSnapshot()
  return <ChatWorkspace initial={snapshot} />
}
