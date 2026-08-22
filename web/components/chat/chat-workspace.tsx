"use client"

import { useState } from "react"

import { ChatMain } from "@/components/chat/chat-main"
import { initialChatUiState } from "@/lib/chat/seed"
import { getActiveChat, sendMessage } from "@/lib/chat/state"

export function ChatWorkspace() {
  const [state, setState] = useState(initialChatUiState)
  const activeChat = getActiveChat(state)

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ChatMain
        chat={activeChat}
        onSend={(content, attachments) => {
          setState((current) => sendMessage(current, content, attachments))
        }}
      />
    </div>
  )
}
