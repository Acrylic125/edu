import type { TopicId, MessageId } from "./ids"
import type { MessagePart, ResponseMessage } from "./ws-schema"

export type { TopicId, MessageId }

export type ChatMessageAttachment = {
  id: string
  name: string
  mimeType: string
  previewUrl: string
}

export type ChatMessage = Omit<ResponseMessage, "createdAt"> & {
  status?: "streaming" | "complete" | "cancelled" | "failed"
  progress?: string[]
}

export type { TopicListing } from "./ws-schema"
import type { TopicListing } from "./ws-schema"

export type TopicCatalog = {
  byId: Record<TopicId, TopicListing>
  order: TopicId[]
}

export type TopicHandoff = {
  topicId: TopicId
  title: string
  summary: string
}

export type TopicTransitionDirection = "up" | "down"

export type ChatSession =
  | { kind: "none" }
  | {
      kind: "topic"
      topicId: TopicId
      title: string
      messages: ChatMessage[]
      handoff: TopicHandoff | null
      part?: string | null
      currentStepId?: string | null
    }

export type SocketFact =
  | { status: "boot" }
  | { status: "connecting" }
  | { status: "ready"; userId: string }
  | { status: "error"; message: string }

export type RunFact =
  | { status: "idle" }
  | { status: "running"; runId: string; messageId: MessageId }

export type Gate = "blocked" | "send" | "stop"

export type CurrentMessagesPayload = {
  topic: {
    id: TopicId
    title: string
    part?: string | null
    currentStepId?: string | null
  } | null
  messages: ChatMessage[]
}

export type ChatBootstrap = {
  catalog: TopicCatalog
  session: ChatSession
}

export type ChatStoreState = {
  error: string | null
  catalog: TopicCatalog
  session: ChatSession
  socket: SocketFact
  run: RunFact
  switch: null | { topicId: TopicId; direction: TopicTransitionDirection }
  topicEntry: null | {
    topicId: TopicId
    direction: TopicTransitionDirection
  }
  revealed: boolean
  topicCreation: null | {
    status: "creating" | "failed"
    parts: MessagePart[]
    error: string | null
  }
  optionState: null | {
    messageId: MessageId
    status: "pending" | "failed"
  }
}

export type ShellPhase =
  | {
      show: "skeleton"
      reason: "boot" | "connecting" | "switch"
    }
  | {
      show: "thread"
      topicId: TopicId | null
      title: string
      messages: ChatMessage[]
      empty: boolean
      handoff: TopicHandoff | null
    }
  | { show: "error"; message: string }
