import { Suspense } from "react"

import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { loadCurrentChatSnapshot } from "@/lib/chat/load-topic-snapshot"
import { initialChatUiState } from "@/lib/chat/seed"

export default function Home() {
  return (
    <Suspense fallback={<ChatWorkspace initial={initialChatUiState} />}>
      <CurrentTopicChat />
    </Suspense>
  )
}

async function CurrentTopicChat() {
  const snapshot = await loadCurrentChatSnapshot()
  return <ChatWorkspace initial={snapshot} />
}
