import type { MessageId, TopicId } from "./ids"
import type {
  ChatMessage,
  ChatMessageAttachment,
  ChatSession,
  RunFact,
  TopicHandoff,
} from "./types"
import type { MessagePart, WsServerMessage } from "./ws-schema"

export const NEW_CHAT_TITLE = "New chat"

const TITLE_MAX_CHARS = 40

export type SessionEvent =
  | {
      type: "user_sent"
      messageId: MessageId
      content: string
      attachments: ChatMessageAttachment[]
    }
  | { type: "ws"; message: WsServerMessage }
  | { type: "socket_closed" }
  | { type: "topic_born"; topicId: TopicId; previous: TopicHandoff | null }

export function titleFromContent(content: string) {
  const collapsed = content.trim().replace(/\s+/g, " ")
  if (collapsed.length <= TITLE_MAX_CHARS) {
    if (collapsed.length === 0) {
      return NEW_CHAT_TITLE
    }
    return collapsed
  }
  return `${collapsed.slice(0, TITLE_MAX_CHARS).trimEnd()}…`
}

export function reduceSession(
  session: ChatSession,
  run: RunFact,
  event: SessionEvent
) {
  if (event.type === "user_sent") {
    return applyUserSent(session, run, event)
  }
  if (event.type === "socket_closed") {
    return {
      session,
      run: { status: "idle" as const },
    }
  }
  if (event.type === "topic_born") {
    return {
      session: {
        kind: "topic" as const,
        topicId: event.topicId,
        title: NEW_CHAT_TITLE,
        messages: [],
        handoff: event.previous,
      },
      run,
    }
  }
  return applyServerMessage(session, run, event.message)
}

function applyUserSent(
  session: ChatSession,
  run: RunFact,
  event: Extract<SessionEvent, { type: "user_sent" }>
) {
  const trimmed = event.content.trim()
  if (trimmed === "" && event.attachments.length === 0) {
    return { session, run }
  }

  const user = userMessage(event.messageId, trimmed, event.attachments)
  const nextRun: RunFact = {
    status: "running",
    runId: "",
    messageId: "",
  }

  if (session.kind === "none") {
    return {
      session: {
        kind: "topic" as const,
        topicId: "",
        title: titleFromContent(trimmed),
        messages: [user],
        handoff: null,
      },
      run: nextRun,
    }
  }

  let title = session.title
  if (session.title === NEW_CHAT_TITLE && trimmed.length > 0) {
    title = titleFromContent(trimmed)
  }

  return {
    session: {
      ...session,
      title,
      messages: [...session.messages, user],
    },
    run: nextRun,
  }
}

function userMessage(
  id: MessageId,
  content: string,
  attachments: ChatMessageAttachment[]
) {
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
  session: ChatSession,
  run: RunFact,
  message: WsServerMessage
) {
  switch (message.type) {
    case "ready":
      return { session, run: { status: "idle" as const } }
    case "error": {
      if (message.runId) {
        return { session, run: { status: "idle" as const } }
      }
      return { session, run: { status: "idle" as const } }
    }
    case "run.started":
      return applyRunStarted(session, message)
    case "run.delta":
      return applyRunDelta(session, run, message)
    case "run.progress":
      return applyRunProgress(session, run, message)
    case "run.ended":
      return applyRunEnded(session, message)
    default: {
      const _exhaustive: never = message
      return _exhaustive
    }
  }
}

function applyRunStarted(
  session: ChatSession,
  message: Extract<WsServerMessage, { type: "run.started" }>
) {
  const nextRun: RunFact = {
    status: "running",
    runId: message.runId,
    messageId: message.messageId,
  }

  if (session.kind === "none") {
    return { session, run: nextRun }
  }

  const existing = session.messages.some((item) => item.id === message.messageId)
  if (existing) {
    return { session, run: nextRun }
  }

  return {
    session: {
      ...session,
      messages: [
        ...session.messages,
        {
          id: message.messageId,
          role: "assistant" as const,
          parts: [{ type: "text" as const, content: "" }],
          status: "streaming" as const,
          progress: [],
        },
      ],
    },
    run: nextRun,
  }
}

function applyRunDelta(
  session: ChatSession,
  run: RunFact,
  message: Extract<WsServerMessage, { type: "run.delta" }>
) {
  if (session.kind === "none") {
    return { session, run }
  }

  const hasMessage = session.messages.some((item) => item.id === message.messageId)
  if (!hasMessage) {
    return { session, run }
  }

  return {
    session: {
      ...session,
      messages: session.messages.map((item) => {
        if (item.id !== message.messageId) {
          return item
        }
        return {
          ...item,
          parts: appendDelta(item.parts, message.partIndex, message.text),
          status: "streaming" as const,
        }
      }),
    },
    run,
  }
}

function applyRunProgress(
  session: ChatSession,
  run: RunFact,
  message: Extract<WsServerMessage, { type: "run.progress" }>
) {
  if (session.kind === "none") {
    return { session, run }
  }

  const hasMessage = session.messages.some(
    (item) => item.id === message.messageId
  )
  if (!hasMessage) {
    return {
      session: {
        ...session,
        messages: [
          ...session.messages,
          {
            id: message.messageId,
            role: "assistant" as const,
            parts: [{ type: "text" as const, content: "" }],
            status: "streaming" as const,
            progress: [message.label],
          },
        ],
      },
      run,
    }
  }

  return {
    session: {
      ...session,
      messages: session.messages.map((item) => {
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
      }),
    },
    run,
  }
}

function applyRunEnded(
  session: ChatSession,
  message: Extract<WsServerMessage, { type: "run.ended" }>
) {
  const nextRun: RunFact = { status: "idle" }

  if (session.kind === "none") {
    return { session, run: nextRun }
  }

  let status: "complete" | "cancelled" = "complete"
  if (message.status === "cancelled") {
    status = "cancelled"
  }

  const hasMessage = session.messages.some((item) => item.id === message.messageId)
  if (!hasMessage) {
    return {
      session: {
        ...session,
        messages: [
          ...session.messages,
          {
            id: message.messageId,
            role: "assistant" as const,
            parts: message.parts,
            status,
          },
        ],
      },
      run: nextRun,
    }
  }

  return {
    session: {
      ...session,
      messages: session.messages.map((item) => {
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
      }),
    },
    run: nextRun,
  }
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

export function topicIdFromWs(message: WsServerMessage) {
  if (message.type === "run.started" || message.type === "run.ended") {
    return message.topicId
  }
  return undefined
}

export function handoffFromSession(session: ChatSession): TopicHandoff | null {
  if (session.kind !== "topic") {
    return null
  }
  if (session.topicId === "") {
    return null
  }
  return { topicId: session.topicId, title: session.title }
}
