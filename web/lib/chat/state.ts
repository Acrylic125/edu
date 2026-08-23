import type {
  Chat,
  ChatId,
  ChatMessage,
  ChatMessageAttachment,
  ChatUiState,
  SendAffordance,
} from "./types"
import type { MessagePart, WsServerMessage } from "./ws-schema"

export const NEW_CHAT_TITLE = "New chat"

const TITLE_MAX_CHARS = 40

export type ChatEvent =
  | {
      type: "user_sent"
      messageId: string
      content: string
      attachments: ChatMessageAttachment[]
    }
  | { type: "ws"; message: WsServerMessage }
  | { type: "socket_closed" }

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

export function sendAffordance(
  connection: ChatUiState["connection"],
  activity: ChatUiState["activity"],
  draft: string,
  hasAttachments: boolean,
  attachmentsReady = true
): SendAffordance {
  if (connection.status !== "ready") {
    return "disabled"
  }
  if (activity.status === "running") {
    return "stop"
  }
  if (draft.trim() === "" && !hasAttachments) {
    return "disabled"
  }
  if (hasAttachments && !attachmentsReady) {
    return "disabled"
  }
  return "send"
}

export function reduceChat(state: ChatUiState, event: ChatEvent): ChatUiState {
  if (event.type === "user_sent") {
    return applyUserSent(state, event.messageId, event.content, event.attachments)
  }
  if (event.type === "socket_closed") {
    return {
      ...state,
      connection: { status: "connecting" },
      activity: { status: "idle" },
    }
  }
  return applyServerMessage(state, event.message)
}

function applyUserSent(
  state: ChatUiState,
  messageId: string,
  content: string,
  attachments: ChatMessageAttachment[]
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
      activity: { status: "running", runId: "", messageId: "" },
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
    activity: { status: "running", runId: "", messageId: "" },
  }
}

function userMessage(
  id: string,
  content: string,
  attachments: ChatMessageAttachment[]
): ChatMessage {
  const parts: MessagePart[] = []
  if (content.length > 0) {
    parts.push({ type: "text", content })
  }
  const message: ChatMessage = {
    id,
    role: "user",
    parts,
  }
  if (attachments.length > 0) {
    message.attachments = attachments
  }
  return message
}

function applyServerMessage(
  state: ChatUiState,
  message: WsServerMessage
): ChatUiState {
  switch (message.type) {
    case "ready":
      return {
        ...state,
        connection: { status: "ready", userId: message.userId },
        // Reconnect mid-run: don't keep a stale Working… spinner.
        activity: { status: "idle" },
      }
    case "error": {
      if (message.runId) {
        return {
          ...state,
          activity: { status: "idle" },
        }
      }
      return {
        ...state,
        connection: { status: "error", message: message.message },
        activity: { status: "idle" },
      }
    }
    case "run.started":
      return applyRunStarted(state, message)
    case "run.delta":
      return applyRunDelta(state, message)
    case "run.progress":
      return applyRunProgress(state, message)
    case "run.ended":
      return applyRunEnded(state, message)
    default: {
      const _exhaustive: never = message
      return _exhaustive
    }
  }
}

function applyRunStarted(
  state: ChatUiState,
  message: Extract<WsServerMessage, { type: "run.started" }>
): ChatUiState {
  const active = getActiveChat(state)
  if (active === null) {
    return {
      ...state,
      activity: {
        status: "running",
        runId: message.runId,
        messageId: message.messageId,
      },
    }
  }

  const existing = active.messages.some((item) => item.id === message.messageId)
  let messages = active.messages
  if (!existing) {
    messages = [
      ...active.messages,
      {
        id: message.messageId,
        role: "assistant" as const,
        parts: [{ type: "text" as const, content: "" }],
        status: "streaming" as const,
        progress: [],
      },
    ]
  }

  const chat = withTopic(
    {
      ...active,
      messages,
    },
    message.topicId
  )

  return replaceActiveChat(state, chat, {
    status: "running",
    runId: message.runId,
    messageId: message.messageId,
  })
}

function applyRunDelta(
  state: ChatUiState,
  message: Extract<WsServerMessage, { type: "run.delta" }>
): ChatUiState {
  const active = getActiveChat(state)
  if (active === null) {
    return state
  }

  return replaceActiveChat(
    state,
    {
      ...active,
      messages: active.messages.map((item) => {
        if (item.id !== message.messageId) {
          return item
        }
        return {
          ...item,
          parts: appendDelta(item.parts, message.partIndex, message.text),
          status: "streaming",
        }
      }),
    },
    state.activity
  )
}

function applyRunProgress(
  state: ChatUiState,
  message: Extract<WsServerMessage, { type: "run.progress" }>
): ChatUiState {
  const active = getActiveChat(state)
  if (active === null) {
    return state
  }

  const hasMessage = active.messages.some(
    (item) => item.id === message.messageId
  )
  let messages = active.messages.map((item) => {
    if (item.id !== message.messageId) {
      return item
    }
    const previous = item.progress ?? []
    const last = previous[previous.length - 1]
    if (last === message.label) {
      return item
    }
    return {
      ...item,
      progress: [...previous, message.label],
      status: "streaming" as const,
    }
  })
  if (!hasMessage) {
    messages = [
      ...active.messages,
      {
        id: message.messageId,
        role: "assistant" as const,
        parts: [{ type: "text" as const, content: "" }],
        status: "streaming" as const,
        progress: [message.label],
      },
    ]
  }

  return replaceActiveChat(
    state,
    {
      ...active,
      messages,
    },
    state.activity
  )
}

function applyRunEnded(
  state: ChatUiState,
  message: Extract<WsServerMessage, { type: "run.ended" }>
): ChatUiState {
  const active = getActiveChat(state)
  if (active === null) {
    return { ...state, activity: { status: "idle" } }
  }

  let status: "complete" | "cancelled" = "complete"
  if (message.status === "cancelled") {
    status = "cancelled"
  }

  const hasMessage = active.messages.some((item) => item.id === message.messageId)
  let messages = active.messages.map((item) => {
    if (item.id !== message.messageId) {
      return item
    }
    let nextParts = item.parts
    if (message.parts.length > 0) {
      nextParts = message.parts
    }
    return {
      ...item,
      parts: nextParts,
      status,
      progress: undefined,
    }
  })
  if (!hasMessage) {
    messages = [
      ...active.messages,
      {
        id: message.messageId,
        role: "assistant",
        parts: message.parts,
        status,
      },
    ]
  }

  const chat = withTopic(
    {
      ...active,
      messages,
    },
    message.topicId
  )

  return replaceActiveChat(state, chat, { status: "idle" })
}

function appendDelta(parts: MessagePart[], partIndex: number, text: string) {
  const next = [...parts]
  const part = next[partIndex]
  if (!part || part.type !== "text") {
    next[partIndex] = { type: "text", content: text }
    return next
  }
  next[partIndex] = { type: "text", content: part.content + text }
  return next
}

function withTopic(chat: Chat, topicId: string | undefined) {
  if (!topicId) {
    return chat
  }
  const next: Chat = {
    ...chat,
    topicId,
  }
  if (chat.id !== topicId) {
    next.id = topicId
  }
  return next
}

function replaceActiveChat(
  state: ChatUiState,
  chat: Chat,
  activity: ChatUiState["activity"]
): ChatUiState {
  const previousId = state.activeChatId
  return {
    ...state,
    activity,
    activeChatId: chat.id,
    chats: state.chats.map((item) => {
      if (item.id === previousId || item.id === chat.id) {
        return chat
      }
      return item
    }),
  }
}

export function sendMessage(
  state: ChatUiState,
  content: string,
  attachments: ChatMessageAttachment[] = [],
  messageId = createId()
): ChatUiState {
  return reduceChat(state, {
    type: "user_sent",
    messageId,
    content,
    attachments,
  })
}
