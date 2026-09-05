"use client"

import { useSession } from "@/lib/auth-client"
import {
  fetchCurrentMessages,
  fetchTopics,
  postSelectTopic,
} from "@/lib/chat/http"
import type { TopicId, TopicTransitionDirection } from "@/lib/chat/types"
import { useChatStoreApi } from "@/lib/chat/store"

export function useSwitchTopic() {
  const session = useSession()
  const store = useChatStoreApi()

  return async function switchTopic(topicId: TopicId) {
    const token = session.data?.session.token
    if (!token) {
      return
    }

    const state = store.getState()
    if (state.run.status === "running" || state.switch !== null) return
    if (state.session.kind === "topic" && state.session.topicId === topicId) {
      return
    }

    let direction: TopicTransitionDirection = "down"
    if (state.session.kind === "topic") {
      const currentIndex = state.catalog.order.indexOf(state.session.topicId)
      const targetIndex = state.catalog.order.indexOf(topicId)
      if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex) {
        direction = "up"
      }
    }

    store.getState().beginSwitch(topicId, direction)
    try {
      await postSelectTopic(token, topicId)
      const [current, catalog] = await Promise.all([
        fetchCurrentMessages(token),
        fetchTopics(token),
      ])
      if (current.topic?.id !== topicId) {
        throw new Error("Topic switch did not stick")
      }
      store.getState().commitSwitch(current)
      store.getState().replaceCatalog(catalog)
    } catch {
      store.getState().failSwitch("Could not switch topic")
    }
  }
}
