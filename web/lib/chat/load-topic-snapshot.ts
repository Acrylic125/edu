import { getSession } from "@/lib/auth-server"
import { env } from "@/env"
import { initialChatUiState } from "@/lib/chat/seed"
import type { ChatMessage, ChatUiState } from "@/lib/chat/types"
import {
  CurrentTopicMessagesSchema,
  type ResponseMessage,
} from "@/lib/chat/ws-schema"

export async function loadCurrentChatSnapshot() {
  const session = await getSession()
  if (!session) {
    return initialChatUiState
  }

  const url = new URL("/topics/current/messages", env.NEXT_PUBLIC_API_URL)
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.session.token}`,
    },
    cache: "no-store",
  })
  if (!response.ok) {
    return initialChatUiState
  }

  const json: unknown = await response.json()
  const parsed = CurrentTopicMessagesSchema.safeParse(json)
  if (!parsed.success) {
    return initialChatUiState
  }

  if (parsed.data.topic === null) {
    return initialChatUiState
  }

  const snapshot: ChatUiState = {
    chats: [
      {
        id: parsed.data.topic.id,
        title: parsed.data.topic.title,
        topicId: parsed.data.topic.id,
        messages: parsed.data.messages.map(toChatMessage),
      },
    ],
    activeChatId: parsed.data.topic.id,
    connection: { status: "connecting" },
    activity: { status: "idle" },
  }
  return snapshot
}

function toChatMessage(message: ResponseMessage) {
  const mapped: ChatMessage = {
    id: message.id,
    role: message.role === "agent" ? "assistant" : "user",
    parts: message.parts,
  }
  if (mapped.role === "assistant") {
    mapped.status = "complete"
  }

  const attachments: ChatMessage["attachments"] = []
  for (const part of message.parts) {
    if (part.type !== "attachment") {
      continue
    }
    if (!part.url) {
      continue
    }
    attachments.push({
      id: part.ref,
      name: part.filename ?? "image",
      mimeType: part.mimeType ?? "image/jpeg",
      previewUrl: part.url,
    })
  }
  if (attachments.length > 0) {
    mapped.attachments = attachments
  }
  return mapped
}
