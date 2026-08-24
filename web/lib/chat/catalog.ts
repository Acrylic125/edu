import type { TopicCatalog, TopicListing } from "./types"
import type { TopicId } from "./ids"

export function emptyCatalog(): TopicCatalog {
  return { byId: {}, order: [] }
}

export function catalogFromTopics(topics: TopicListing[]): TopicCatalog {
  const byId: Record<TopicId, TopicListing> = {}
  const order: TopicId[] = []
  for (const topic of topics) {
    byId[topic.id] = topic
    order.push(topic.id)
  }
  return { byId, order }
}

export function upsertListing(
  catalog: TopicCatalog,
  listing: TopicListing
): TopicCatalog {
  const exists = catalog.byId[listing.id] !== undefined
  const byId = { ...catalog.byId, [listing.id]: listing }
  if (exists) {
    return { byId, order: catalog.order }
  }
  return { byId, order: [listing.id, ...catalog.order] }
}

export function listingOf(
  catalog: TopicCatalog,
  topicId: TopicId
): TopicListing | null {
  return catalog.byId[topicId] ?? null
}
