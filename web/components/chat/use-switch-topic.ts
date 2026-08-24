"use client"

import { useSession } from "@/lib/auth-client"
import {
  fetchCurrentMessages,
  fetchTopics,
  postSelectTopic,
} from "@/lib/chat/http"
import type { TopicId } from "@/lib/chat/types"
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
    if (state.session.kind === "topic" && state.session.topicId === topicId) {
      return
    }

    store.getState().beginSwitch(topicId)
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
