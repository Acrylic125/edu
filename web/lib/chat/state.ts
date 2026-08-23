import type {
  Chat,
  ChatId,
  ChatMessage,
  ChatMessageAttachment,
  ChatUiState,
} from "./types"
import { partsToText, type WsServerMessage } from "./ws-schema"

export const NEW_CHAT_TITLE = "New chat"

const TITLE_MAX_CHARS = 40

export function createId(): string {
  return crypto.randomUUID()
}

export function titleFromContent(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, " ")
  if (collapsed.length <= TITLE_MAX_CHARS) {
    if (collapsed.length === 0) {
      return NEW_CHAT_TITLE
    }
    return collapsed
  }
  return `${collapsed.slice(0, TITLE_MAX_CHARS).trimEnd()}…`
}

export function getActiveChat(state: ChatUiState): Chat | null {
  if (state.activeChatId === null) {
    return null
  }
  return state.chats.find((chat) => chat.id === state.activeChatId) ?? null
}

export function createChat(state: ChatUiState): ChatUiState {
  const chat: Chat = {
    id: createId(),
    title: NEW_CHAT_TITLE,
    messages: [],
  }
  return {
    ...state,
    chats: [chat, ...state.chats],
    activeChatId: chat.id,
  }
}

export function selectChat(state: ChatUiState, chatId: ChatId): ChatUiState {
  return {
    ...state,
    activeChatId: chatId,
  }
}

export function sendMessage(
  state: ChatUiState,
  content: string,
  attachments: ChatMessageAttachment[] = [],
  messageId = createId()
): ChatUiState {
  const trimmed = content.trim()
  if (trimmed === "" && attachments.length === 0) {
    return state
  }

  const user = userMessage(messageId, trimmed, attachments)

  const active = getActiveChat(state)
  if (active === null) {
    const chat: Chat = {
      id: createId(),
      title: titleFromContent(trimmed),
      messages: [user],
    }
    return {
      ...state,
      chats: [chat, ...state.chats],
      activeChatId: chat.id,
    }
  }

  let title = active.title
  if (active.title === NEW_CHAT_TITLE && trimmed.length > 0) {
    title = titleFromContent(trimmed)
  }

  return {
    ...state,
    chats: state.chats.map((chat) => {
      if (chat.id !== active.id) {
        return chat
      }
      return {
        ...chat,
        title,
        messages: [...chat.messages, user],
      }
    }),
    activeChatId: active.id,
  }
}

function userMessage(
  id: string,
  content: string,
  attachments: ChatMessageAttachment[]
): ChatMessage {
  const message: ChatMessage = {
    id,
    role: "user",
    content,
  }
  if (attachments.length > 0) {
    message.attachments = attachments
  }
  return message
}

function connectionUserId(state: ChatUiState) {
  if (state.connection.status === "ready") {
    return state.connection.userId
  }
  if (state.connection.status === "busy") {
    return state.connection.userId
  }
  return null
}

function uiRole(role: "user" | "agent") {
  if (role === "agent") {
    return "assistant" as const
  }
  return "user" as const
}

export function applyServerMessage(
  state: ChatUiState,
  message: WsServerMessage
): ChatUiState {
  switch (message.type) {
    case "ready":
      return {
        ...state,
        connection: { status: "ready", userId: message.userId },
      }
    case "busy": {
      const userId = connectionUserId(state)
      if (userId === null) {
        return {
          ...state,
          connection: { status: "error", message: message.message },
        }
      }
      return {
        ...state,
        connection: {
          status: "busy",
          userId,
          message: message.message,
        },
      }
    }
    case "error":
      return {
        ...state,
        connection: { status: "error", message: message.message },
      }
    case "response":
      return applyChatResponse(state, message)
  }
}

function applyChatResponse(
  state: ChatUiState,
  message: Extract<WsServerMessage, { type: "response" }>
): ChatUiState {
  const userId = connectionUserId(state)
  let connection: ChatUiState["connection"]
  if (userId === null) {
    connection = { status: "connecting" }
  } else {
    connection = { status: "ready", userId }
  }

  const active = getActiveChat(state)
  if (active === null) {
    return { ...state, connection }
  }

  const existingIds = new Set(active.messages.map((item) => item.id))
  const appended: ChatMessage[] = []
  for (const item of message.messages) {
    if (existingIds.has(item.id)) {
      continue
    }
    appended.push({
      id: item.id,
      role: uiRole(item.role),
      content: partsToText(item.parts),
    })
  }

  return {
    ...state,
    connection,
    chats: state.chats.map((chat) => {
      if (chat.id !== active.id) {
        return chat
      }
      const next: Chat = {
        ...chat,
        messages: [...chat.messages, ...appended],
      }
      if (message.topicId) {
        next.topicId = message.topicId
      }
      return next
    }),
  }
}
