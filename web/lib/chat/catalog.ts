import type { TopicCatalog, TopicHandoff, TopicListing } from "./types"
import type { TopicId } from "./ids"

export function emptyCatalog(): TopicCatalog {
  return { byId: {}, order: [] }
}

function compareCreatedAt(a: TopicListing, b: TopicListing) {
  if (a.createdAt === b.createdAt) {
    return a.id.localeCompare(b.id)
  }
  // Stubs without a timestamp sort last until the catalog refresh lands.
  if (a.createdAt === "") {
    return 1
  }
  if (b.createdAt === "") {
    return -1
  }
  if (a.createdAt < b.createdAt) {
    return -1
  }
  return 1
}

function orderByCreatedAt(listings: TopicListing[]) {
  return [...listings].sort(compareCreatedAt).map((listing) => listing.id)
}

export function catalogFromTopics(topics: TopicListing[]): TopicCatalog {
  const byId: Record<TopicId, TopicListing> = {}
  for (const topic of topics) {
    byId[topic.id] = topic
  }
  return {
    byId,
    order: orderByCreatedAt(topics),
  }
}

export function upsertListing(
  catalog: TopicCatalog,
  listing: TopicListing
): TopicCatalog {
  const byId = { ...catalog.byId, [listing.id]: listing }
  return {
    byId,
    order: orderByCreatedAt(Object.values(byId)),
  }
}

export function listingOf(
  catalog: TopicCatalog,
  topicId: TopicId
): TopicListing | null {
  return catalog.byId[topicId] ?? null
}

function toHandoff(listing: TopicListing | null): TopicHandoff | null {
  if (listing === null) {
    return null
  }
  return {
    topicId: listing.id,
    title: listing.title,
    summary: listing.summary,
  }
}

/** Immediate neighbor before `currentTopicId` in creation order. */
export function resolvePreviousTopic(
  catalog: TopicCatalog,
  currentTopicId: TopicId | null
): TopicHandoff | null {
  if (currentTopicId === null) {
    return null
  }
  const index = catalog.order.indexOf(currentTopicId)
  if (index <= 0) {
    return null
  }
  const previousId = catalog.order[index - 1]
  if (previousId === undefined) {
    return null
  }
  return toHandoff(catalog.byId[previousId] ?? null)
}

/** Immediate neighbor after `currentTopicId` in creation order. */
export function resolveNextTopic(
  catalog: TopicCatalog,
  currentTopicId: TopicId | null
): TopicHandoff | null {
  if (currentTopicId === null) {
    return null
  }
  const index = catalog.order.indexOf(currentTopicId)
  if (index < 0 || index >= catalog.order.length - 1) {
    return null
  }
  const nextId = catalog.order[index + 1]
  if (nextId === undefined) {
    return null
  }
  return toHandoff(catalog.byId[nextId] ?? null)
}
