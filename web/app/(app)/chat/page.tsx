import { Suspense } from "react"

import { LearningWorkspace } from "@/components/chat/learning-workspace"
import { loadChatBootstrap } from "@/lib/chat/load-bootstrap"

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading Prune…</div>
      }
    >
      <BootedChat />
    </Suspense>
  )
}

async function BootedChat() {
  const bootstrap = await loadChatBootstrap()
  return <LearningWorkspace key="new" bootstrap={bootstrap} />
}
