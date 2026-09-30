import { Suspense } from "react"
import type { ReactNode } from "react"

import { ChatFrame } from "@/components/chat/chat-frame"
import { loadChatCatalog } from "@/lib/chat/load-bootstrap"

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading Prune…</div>}>
      <ChatShell>{children}</ChatShell>
    </Suspense>
  )
}

async function ChatShell({ children }: { children: ReactNode }) {
  const catalog = await loadChatCatalog()
  return <ChatFrame catalog={catalog}>{children}</ChatFrame>
}
