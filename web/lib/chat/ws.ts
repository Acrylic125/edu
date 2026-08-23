"use client"

import useWebSocket from "react-use-websocket"
import type { Options } from "react-use-websocket"

import { env } from "@/env"

export function getChatWebSocketUrl(token: string) {
  const url = new URL("/chat", env.NEXT_PUBLIC_API_URL)
  url.searchParams.set("token", token)
  if (url.protocol === "https:") {
    url.protocol = "wss:"
  } else {
    url.protocol = "ws:"
  }
  return url.href
}

const sharedWebSocketOptions = {
  share: true,
  shouldReconnect: () => true,
  reconnectAttempts: 10,
  reconnectInterval: 3000,
} as const satisfies Options

export function useChatWebSocket(
  socketUrl: string | null,
  options?: Options
) {
  return useWebSocket(socketUrl, {
    ...sharedWebSocketOptions,
    ...options,
  })
}
