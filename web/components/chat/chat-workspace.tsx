"use client"

import { useState } from "react"

import { ChatMain } from "@/components/chat/chat-main"
import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { initialChatUiState } from "@/lib/chat/seed"
import {
  createChat,
  getActiveChat,
  selectChat,
  sendMessage,
} from "@/lib/chat/state"
import type { ChatId } from "@/lib/chat/types"

export function ChatWorkspace() {
  const [state, setState] = useState(initialChatUiState)
  const activeChat = getActiveChat(state)

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <ChatSidebar
        chats={state.chats}
        activeChatId={state.activeChatId}
        onSelect={(chatId: ChatId) => {
          setState((current) => selectChat(current, chatId))
        }}
        onNewChat={() => {
          setState(createChat)
        }}
      />
      <ChatMain
        chat={activeChat}
        onSend={(content) => {
          setState((current) => sendMessage(current, content))
        }}
      />
    </SidebarProvider>
  )
}
