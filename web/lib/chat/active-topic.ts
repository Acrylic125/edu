import type { ChatSession } from "./types"

/** Topic id to bind on the next WS message, if the client has an active topic. */
export function activeTopicIdForSend(session: ChatSession) {
  if (session.kind !== "topic") {
    return undefined
  }
  if (session.topicId === "") {
    return undefined
  }
  return session.topicId
}
