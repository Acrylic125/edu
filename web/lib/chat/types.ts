import type { MessagePart } from "./ws-schema"

export type ChatId = string
export type MessageId = string
export type MessageRole = "user" | "assistant"

export type ChatMessageAttachment = {
  id: string
  name: string
  mimeType: string
  previewUrl: string
}

export type ChatMessage = {
  id: MessageId
  role: MessageRole
  parts: MessagePart[]
  attachments?: ChatMessageAttachment[]
  status?: "streaming" | "complete" | "cancelled"
  progress?: string[]
}

export type Chat = {
  id: ChatId
  title: string
  messages: ChatMessage[]
  topicId?: string
}

export type ChatConnection =
  | { status: "connecting" }
  | { status: "ready"; userId: string }
  | { status: "error"; message: string }

export type ChatActivity =
  | { status: "idle" }
  | { status: "running"; runId: string; messageId: string }

export type SendAffordance = "disabled" | "send" | "stop"

export type ChatUiState = {
  chats: Chat[]
  activeChatId: ChatId | null
  connection: ChatConnection
  activity: ChatActivity
}
