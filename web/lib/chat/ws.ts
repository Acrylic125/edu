"use client"

import useWebSocket from "react-use-websocket"
import type { Options } from "react-use-websocket"

import { env } from "@/env"

export function getChatWebSocketUrl() {
  const url = new URL("/chat", env.NEXT_PUBLIC_API_URL)
  if (url.protocol === "https:") {
    url.protocol = "wss:"
  } else {
    url.protocol = "ws:"
  }
  return url.href
}

const sharedWebSocketOptions = {
  // Do not share across mounts: Suspense/Strict Mode can unmount a sibling
  // subscriber and tear down the socket while the live chat still needs it.
  share: false,
  shouldReconnect: () => true,
  reconnectAttempts: 10,
  reconnectInterval: 3000,
} as const satisfies Options

export function useChatWebSocket(socketUrl: string | null, options?: Options) {
  return useWebSocket(socketUrl, {
    ...sharedWebSocketOptions,
    ...options,
  })
}
