import type { Snapshot, Workspace } from "./contracts"

export function mostRecentTopic({ topics, chats }: { topics: Snapshot["topics"]; chats: Pick<Workspace["chats"][number], "messages">[] }) {
  let recent: Snapshot["topics"][number] | undefined
  let latest = ""
  for (const chat of chats) {
    const ids = [...new Set(chat.messages.flatMap((message) => message.topicIds).reverse())]
    let lastMessage = ""
    for (const message of chat.messages) {
      if (message.createdAt > lastMessage) lastMessage = message.createdAt
    }
    if (lastMessage <= latest) continue
    const topic = ids.map((id) => topics.find((topic) => topic.id === id))
      .find((topic) => topic && (topic.state?.type ?? "topic") === "topic")
    if (!topic) continue
    recent = topic
    latest = lastMessage
  }
  return recent
}
