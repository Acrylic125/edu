"use client"

import { useState } from "react"

import { ChatMain } from "@/components/chat/chat-main"
import { useSession } from "@/lib/auth-client"
import { initialChatUiState } from "@/lib/chat/seed"
import { applyServerMessage, getActiveChat, sendMessage } from "@/lib/chat/state"
import { getChatWebSocketUrl, useChatWebSocket } from "@/lib/chat/ws"
import { WsChatClientMessageSchema, WsServerMessageSchema } from "@/lib/chat/ws-schema"

export function ChatWorkspace() {
  const session = useSession()
  const [state, setState] = useState(initialChatUiState)
  const activeChat = getActiveChat(state)

  let socketUrl: string | null = null
  if (session.data) {
    socketUrl = getChatWebSocketUrl(session.data.session.token)
  }

  const { sendJsonMessage } = useChatWebSocket(socketUrl, {
    onMessage: (event) => {
      try {
        const parsed = WsServerMessageSchema.safeParse(JSON.parse(event.data))
        if (!parsed.success) {
          return
        }
        setState((current) => applyServerMessage(current, parsed.data))
      } catch {
        return
      }
    },
    onClose: () => {
      setState((current) => ({
        ...current,
        connection: { status: "connecting" },
      }))
    },
  })

  const composerDisabled =
    state.connection.status === "connecting" ||
    state.connection.status === "busy"

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ChatMain
        chat={activeChat}
        connection={state.connection}
        composerDisabled={composerDisabled}
        onSend={(content, attachments) => {
          if (composerDisabled) {
            return
          }
          if (!session.data) {
            return
          }
          const messageId = crypto.randomUUID()
          const text = content.trim()
          const userId = session.data.user.id
          setState((current) => {
            const next = sendMessage(current, content, attachments, messageId)
            if (text === "") {
              return next
            }
            return {
              ...next,
              connection: {
                status: "busy",
                userId,
                message: "Working…",
              },
            }
          })
          if (text === "") {
            return
          }
          sendJsonMessage(
            WsChatClientMessageSchema.parse({
              type: "message",
              message: messageId,
              parts: [{ type: "text", content: text }],
            })
          )
        }}
      />
    </div>
  )
}
