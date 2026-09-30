import { cache } from "react"
import { notFound } from "next/navigation"

import { emptyCatalog, upsertListing } from "./catalog"
import {
  fetchTopicMessages,
  fetchTopics,
  sessionFromCurrentMessages,
} from "./http"
import { getSession } from "@/lib/auth-server"

export const loadChatCatalog = cache(async () => {
  const session = await getSession()
  if (!session) return emptyCatalog()
  return fetchTopics(session.session.token)
})

export async function loadChatBootstrap(topicId?: string) {
  const session = await getSession()
  if (!session) {
    return {
      catalog: emptyCatalog(),
      session: { kind: "none" as const },
    }
  }

  if (!topicId) {
    return { catalog: await loadChatCatalog(), session: { kind: "none" as const } }
  }

  const [catalog, current] = await Promise.all([
    loadChatCatalog(),
    fetchTopicMessages(session.session.token, topicId),
  ])

  if (!current?.topic || current.topic.id !== topicId) notFound()

  let nextCatalog = catalog
  if (current.topic !== null && catalog.byId[current.topic.id] === undefined) {
    nextCatalog = upsertListing(catalog, {
      id: current.topic.id,
      title: current.topic.title,
      summary: "",
      createdAt: "",
      updatedAt: "",
    })
  }

  return {
    catalog: nextCatalog,
    session: sessionFromCurrentMessages(current),
  }
}
