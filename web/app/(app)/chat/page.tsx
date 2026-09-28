import { Suspense } from "react"

import { LearningWorkspace } from "@/components/chat/learning-workspace"
import { loadChatBootstrap } from "@/lib/chat/load-bootstrap"

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Loading Prune…</div>
      }
    >
      <BootedChat />
    </Suspense>
  )
}

async function BootedChat() {
  const bootstrap = await loadChatBootstrap()
  return <LearningWorkspace bootstrap={bootstrap} />
}
