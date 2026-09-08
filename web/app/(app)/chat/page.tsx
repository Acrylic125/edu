import { Suspense } from "react"

import { ChatApp } from "@/components/chat/chat-app"
import { ChatFrame } from "@/components/chat/chat-frame"
import { MessageSkeletons } from "@/components/chat/message-skeletons"
import { loadChatBootstrap } from "@/lib/chat/load-bootstrap"

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <ChatFrame
          title="Chat"
          status="Connecting"
          body={<MessageSkeletons />}
        />
      }
    >
      <BootedChat />
    </Suspense>
  )
}

async function BootedChat() {
  const bootstrap = await loadChatBootstrap()
  return <ChatApp bootstrap={bootstrap} />
}
