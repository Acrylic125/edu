"use client"

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { useChatFrame } from "@/components/chat/chat-frame"
import { useSession } from "@/lib/auth-client"
import { fetchTopicMessages, fetchTopics, postSelectTopic } from "@/lib/chat/http"
import { useChatStoreApi } from "@/lib/chat/store"
import { getChatWebSocketUrl, useChatWebSocket } from "@/lib/chat/ws"
import {
  WsServerMessageSchema,
  type WsClientEnvelope,
} from "@/lib/chat/ws-schema"

type ChatSendApi = {
  sendJsonMessage: (jsonMessage: WsClientEnvelope) => void
  sendChatRequest: (jsonMessage: Extract<WsClientEnvelope, { type: "message" }>) => Promise<void>
}

const ChatSendContext = createContext<ChatSendApi | null>(null)

export function ChatRealtimeProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const store = useChatStoreApi()
  const router = useRouter()
  const { setCatalog } = useChatFrame()
  const mounted = useRef(true)
  const submissions = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>())

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

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
    onMessage: async (event) => {
      try {
        const raw = JSON.parse(event.data)
        const parsed = WsServerMessageSchema.safeParse(raw)
        if (!parsed.success) {
          return
        }
        if (parsed.data.type === "ready") {
          const current = store.getState().session
          if (current.kind === "topic" && current.topicId && session.data) {
            try {
              await postSelectTopic(session.data.session.token, current.topicId)
            } catch {
              store.setState({ socket: { status: "error", message: "Could not open this topic" }, error: "Could not open this topic" })
              return
            }
          }
        }
        if (!mounted.current) return
        store.getState().applyWs(parsed.data)
        const message = parsed.data
        if ((message.type === "run.started" || message.type === "error") && message.requestId) {
          const pending = submissions.current.get(message.requestId)
          if (message.type === "error") pending?.reject(new Error(message.message))
          else pending?.resolve()
        }
        const bornId = store.getState().takeTopicBornRefresh()
        if (bornId && session.data) {
          const token = session.data.session.token
          const catalog = await refreshAfterTopicBorn(store, token, bornId)
          if (!mounted.current) return
          if (catalog) setCatalog(catalog)
          router.replace(`/chat/${encodeURIComponent(bornId)}`)
        }
      } catch {
        return
      }
    },
    onClose: () => {
      store.getState().applySocketClosed()
      for (const pending of submissions.current.values()) pending.reject(new Error("Connection lost before confirmation. Check the conversation before retrying."))
    },
  })

  function sendChatRequest(message: Extract<WsClientEnvelope, { type: "message" }>) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        submissions.current.delete(message.messageId)
        reject(new Error("Confirmation timed out. Check the conversation before retrying."))
      }, 30_000)
      submissions.current.set(message.messageId, {
        resolve: () => {
          clearTimeout(timer)
          submissions.current.delete(message.messageId)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timer)
          submissions.current.delete(message.messageId)
          reject(error)
        },
      })
      try {
        sendJsonMessage(message, false)
      } catch {
        submissions.current.get(message.messageId)?.reject(new Error("Could not send the request."))
      }
    })
  }

  return (
    <ChatSendContext.Provider value={{ sendJsonMessage, sendChatRequest }}>
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
      fetchTopicMessages(token, topicId),
      fetchTopics(token),
    ])
    const state = store.getState()
    if (state.session.kind !== "topic" || state.session.topicId !== topicId) {
      return
    }
    if (current?.topic?.id !== topicId) {
      store.getState().replaceCatalog(catalog)
      return catalog
    }
    store.getState().replaceCurrentMessages(current)
    store.getState().replaceCatalog(catalog)
    return catalog
  } catch {
    return
  }
}
