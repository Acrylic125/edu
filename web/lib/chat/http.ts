import { catalogFromTopics } from "./catalog"
import { toChatMessage } from "./map-message"
import { z } from "zod"
import type { CurrentMessagesPayload, TopicCatalog, TopicId } from "./types"
import {
  CurrentTopicMessagesSchema,
  TopicDetailResponseSchema,
  TopicsListSchema,
  type UpdateTopicRequest,
} from "./ws-schema"
import { env } from "@/env"

const ErrorResponseSchema = z.object({ error: z.string() })

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

function selectTopicStepUrl(topicId: TopicId, stepId: string) {
  return new URL(
    `/topics/${encodeURIComponent(topicId)}/steps/${encodeURIComponent(stepId)}/select`,
    env.NEXT_PUBLIC_API_URL,
  )
}

function topicUrl(topicId: TopicId) {
  return new URL(`/topics/${encodeURIComponent(topicId)}`, env.NEXT_PUBLIC_API_URL)
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
    summary: payload.topic.summary,
    plan: payload.topic.plan,
    updatedAt: payload.topic.updatedAt,
    messages: payload.messages,
    handoff: null,
    part: payload.topic.part,
    currentStepId: payload.topic.currentStepId,
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

export async function postSelectTopicStep(
  token: string,
  topicId: TopicId,
  stepId: string,
) {
  const response = await fetch(selectTopicStepUrl(topicId, stepId), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error("Could not select plan step")
  }
}

export async function patchTopic(
  token: string,
  topicId: TopicId,
  update: UpdateTopicRequest,
) {
  const response = await fetch(topicUrl(topicId), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(update),
  })
  const json = await response.json()
  if (!response.ok) {
    const error = ErrorResponseSchema.safeParse(json)
    if (error.success) {
      throw new Error(error.data.error)
    }
    throw new Error("Could not save the learning plan")
  }
  const parsed = TopicDetailResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error("Invalid learning plan response")
  }
  return parsed.data.topic
}

export async function fetchTopic(token: string, topicId: TopicId) {
  const response = await fetch(topicUrl(topicId), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  const json = await response.json()
  if (!response.ok) {
    throw new Error("Could not refresh the learning plan")
  }
  const parsed = TopicDetailResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error("Invalid learning plan response")
  }
  return parsed.data.topic
}
