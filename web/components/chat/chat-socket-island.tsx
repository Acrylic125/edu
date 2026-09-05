"use client"

import { createContext, useContext, type ReactNode } from "react"

import { useSession } from "@/lib/auth-client"
import { fetchCurrentMessages, fetchTopics } from "@/lib/chat/http"
import { useChatStoreApi } from "@/lib/chat/store"
import { getChatWebSocketUrl, useChatWebSocket } from "@/lib/chat/ws"
import {
  WsServerMessageSchema,
  type WsClientEnvelope,
} from "@/lib/chat/ws-schema"

type ChatSendApi = {
  sendJsonMessage: (jsonMessage: WsClientEnvelope) => void
}

const ChatSendContext = createContext<ChatSendApi | null>(null)

export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const store = useChatStoreApi()

  let socketUrl: string | null = null
  if (session.data) {
    socketUrl = getChatWebSocketUrl()
  }

  const { sendJsonMessage } = useChatWebSocket(socketUrl, {
    protocols: session.data
      ? [
          "edu-chat",
          `edu-auth.${btoa(session.data.session.token).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`,
        ]
      : undefined,
    onOpen: () => {
      const state = store.getState()
      if (state.socket.status === "ready") {
        return
      }
      store.setState({ socket: { status: "connecting" } })
    },
    onMessage: (event) => {
      try {
        const raw = JSON.parse(event.data)
        const parsed = WsServerMessageSchema.safeParse(raw)
        if (!parsed.success) {
          return
        }
        store.getState().applyWs(parsed.data)
        const bornId = store.getState().takeTopicBornRefresh()
        if (bornId && session.data) {
          const token = session.data.session.token
          void refreshAfterTopicBorn(store, token, bornId)
        }
      } catch {
        return
      }
    },
    onClose: () => {
      store.getState().applySocketClosed()
    },
  })

  return (
    <ChatSendContext.Provider value={{ sendJsonMessage }}>
      {children}
    </ChatSendContext.Provider>
  )
}

export function useChatSend() {
  const value = useContext(ChatSendContext)
  if (!value) {
    throw new Error("useChatSend must be used within ChatRealtimeProvider")
  }
  return value
}

async function refreshAfterTopicBorn(
  store: ReturnType<typeof useChatStoreApi>,
  token: string,
  topicId: string,
) {
  try {
    const [current, catalog] = await Promise.all([
      fetchCurrentMessages(token),
      fetchTopics(token),
    ])
    const state = store.getState()
    if (state.session.kind !== "topic" || state.session.topicId !== topicId) {
      return
    }
    if (current.topic?.id !== topicId) {
      store.getState().replaceCatalog(catalog)
      return
    }
    store.getState().replaceCurrentMessages(current)
    store.getState().replaceCatalog(catalog)
  } catch {
    return
  }
}
