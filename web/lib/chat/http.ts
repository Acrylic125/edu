import { catalogFromTopics } from "./catalog"
import { toChatMessage } from "./map-message"
import type { CurrentMessagesPayload, TopicCatalog, TopicId } from "./types"
import { CurrentTopicMessagesSchema, TopicsListSchema } from "./ws-schema"
import { env } from "@/env"

function topicsUrl() {
  return new URL("/topics", env.NEXT_PUBLIC_API_URL)
}

function currentMessagesUrl() {
  return new URL("/topics/current/messages", env.NEXT_PUBLIC_API_URL)
}

function selectTopicUrl(topicId: TopicId) {
  return new URL(
    `/topics/${encodeURIComponent(topicId)}/select`,
    env.NEXT_PUBLIC_API_URL,
  )
}

export function parseTopicsResponse(json: unknown): TopicCatalog {
  const parsed = TopicsListSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error("Could not load topics")
  }
  return catalogFromTopics(parsed.data.topics)
}

export function parseCurrentMessages(json: unknown): CurrentMessagesPayload {
  const parsed = CurrentTopicMessagesSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error("Invalid messages response")
  }
  return {
    topic: parsed.data.topic,
    messages: parsed.data.messages.map(toChatMessage),
  }
}

export function sessionFromCurrentMessages(payload: CurrentMessagesPayload) {
  if (payload.topic === null) {
    return { kind: "none" as const }
  }
  return {
    kind: "topic" as const,
    topicId: payload.topic.id,
    title: payload.topic.title,
    messages: payload.messages,
    handoff: null,
  }
}

export async function fetchTopics(token: string) {
  const response = await fetch(topicsUrl(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error("Could not load topics")
  }
  const json: unknown = await response.json()
  return parseTopicsResponse(json)
}

export async function fetchCurrentMessages(token: string) {
  const response = await fetch(currentMessagesUrl(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error("Could not load messages")
  }
  const json: unknown = await response.json()
  return parseCurrentMessages(json)
}

export async function postSelectTopic(token: string, topicId: TopicId) {
  const response = await fetch(selectTopicUrl(topicId), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error("Could not switch topic")
  }
}
