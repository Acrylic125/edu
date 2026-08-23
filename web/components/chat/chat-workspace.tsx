"use client"

import { useState } from "react"

import { ChatMain } from "@/components/chat/chat-main"
import { useSession } from "@/lib/auth-client"
import { initialChatUiState } from "@/lib/chat/seed"
import { getActiveChat, reduceChat } from "@/lib/chat/state"
import type { ChatUiState } from "@/lib/chat/types"
import { getChatWebSocketUrl, useChatWebSocket } from "@/lib/chat/ws"
import {
  WsChatClientDecisionSchema,
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  WsServerMessageSchema,
  type MessagePart,
} from "@/lib/chat/ws-schema"

export function ChatWorkspace({ initial }: { initial?: ChatUiState }) {
  const session = useSession()
  const [state, setState] = useState(initial ?? initialChatUiState)
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
        setState((current) =>
          reduceChat(current, { type: "ws", message: parsed.data })
        )
      } catch {
        return
      }
    },
    onClose: () => {
      setState((current) => reduceChat(current, { type: "socket_closed" }))
    },
  })

  function sendUserText(content: string) {
    if (state.connection.status !== "ready") {
      return
    }
    if (state.activity.status === "running") {
      return
    }
    const messageId = crypto.randomUUID()
    const text = content.trim()
    if (text === "") {
      return
    }
    setState((current) =>
      reduceChat(current, {
        type: "user_sent",
        messageId,
        content: text,
        attachments: [],
      })
    )
    sendJsonMessage(
      WsChatClientMessageSchema.parse({
        type: "message",
        message: messageId,
        parts: [{ type: "text", content: text }],
      })
    )
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ChatMain
        chat={activeChat}
        connection={state.connection}
        activity={state.activity}
        onSend={(content, attachments) => {
          if (state.connection.status !== "ready") {
            return
          }
          if (state.activity.status === "running") {
            return
          }
          const messageId = crypto.randomUUID()
          const text = content.trim()
          if (text === "" && attachments.length === 0) {
            return
          }
          setState((current) =>
            reduceChat(current, {
              type: "user_sent",
              messageId,
              content: text,
              attachments,
            })
          )
          const parts: MessagePart[] = []
          if (text.length > 0) {
            parts.push({ type: "text", content: text })
          }
          for (const attachment of attachments) {
            parts.push({ type: "attachment", ref: attachment.id })
          }
          sendJsonMessage(
            WsChatClientMessageSchema.parse({
              type: "message",
              message: messageId,
              parts,
            })
          )
        }}
        onStop={() => {
          if (state.activity.status !== "running") {
            return
          }
          if (state.activity.runId === "") {
            return
          }
          sendJsonMessage(
            WsChatClientStopSchema.parse({
              type: "stop",
              runId: state.activity.runId,
            })
          )
        }}
        onOption={(label) => {
          sendUserText(label)
        }}
        onDecision={(proposalId, decision) => {
          if (state.connection.status !== "ready") {
            return
          }
          if (state.activity.status === "running") {
            return
          }
          sendJsonMessage(
            WsChatClientDecisionSchema.parse({
              type: "decision",
              proposalId,
              decision,
            })
          )
        }}
      />
    </div>
  )
}
