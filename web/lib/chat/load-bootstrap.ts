import { emptyCatalog, upsertListing } from "./catalog"
import {
  fetchCurrentMessages,
  fetchTopics,
  sessionFromCurrentMessages,
} from "./http"
import type { ChatBootstrap } from "./types"
import { getSession } from "@/lib/auth-server"

export async function loadChatBootstrap(): Promise<ChatBootstrap> {
  const session = await getSession()
  if (!session) {
    return {
      catalog: emptyCatalog(),
      session: { kind: "none" },
    }
  }

  const token = session.session.token
  const [catalog, current] = await Promise.all([
    fetchTopics(token),
    fetchCurrentMessages(token),
  ])

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
