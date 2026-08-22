import type { Chat, ChatId, ChatMessage, ChatUiState } from "./types"

export const NEW_CHAT_TITLE = "New chat"
export const MOCK_ASSISTANT_REPLY = "Got it. (UI-only reply)"

const TITLE_MAX_CHARS = 40

export function createId(): string {
  return crypto.randomUUID()
}

export function titleFromContent(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, " ")
  if (collapsed.length <= TITLE_MAX_CHARS) {
    return collapsed.length === 0 ? NEW_CHAT_TITLE : collapsed
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

export function sendMessage(state: ChatUiState, content: string): ChatUiState {
  const trimmed = content.trim()
  if (trimmed === "") {
    return state
  }

  const active = getActiveChat(state)
  if (active === null) {
    const chat: Chat = {
      id: createId(),
      title: titleFromContent(trimmed),
      messages: [userMessage(trimmed), assistantReply()],
    }
    return {
      chats: [chat, ...state.chats],
      activeChatId: chat.id,
    }
  }

  return {
    chats: state.chats.map((chat) => {
      if (chat.id !== active.id) {
        return chat
      }
      return {
        ...chat,
        title:
          chat.title === NEW_CHAT_TITLE
            ? titleFromContent(trimmed)
            : chat.title,
        messages: [...chat.messages, userMessage(trimmed), assistantReply()],
      }
    }),
    activeChatId: active.id,
  }
}

function userMessage(content: string): ChatMessage {
  return { id: createId(), role: "user", content }
}

function assistantReply(): ChatMessage {
  return { id: createId(), role: "assistant", content: MOCK_ASSISTANT_REPLY }
}
