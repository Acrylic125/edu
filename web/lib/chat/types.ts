export type ChatId = string
export type MessageId = string
export type MessageRole = "user" | "assistant"

export type ChatMessage = {
  id: MessageId
  role: MessageRole
  content: string
}

export type Chat = {
  id: ChatId
  title: string
  messages: ChatMessage[]
}

export type ChatUiState = {
  chats: Chat[]
  activeChatId: ChatId | null
}
