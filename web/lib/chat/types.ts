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
  content: string
  attachments?: ChatMessageAttachment[]
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
  | { status: "busy"; userId: string; message: string }
  | { status: "error"; message: string }

export type ChatUiState = {
  chats: Chat[]
  activeChatId: ChatId | null
  connection: ChatConnection
}
