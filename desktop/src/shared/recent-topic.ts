import type { Snapshot, Workspace } from "./contracts"

export function mostRecentTopic({ scratchpads, chats }: { scratchpads: Snapshot["scratchpads"]; chats: Pick<Workspace["chats"][number], "messages">[] }) {
  let recent: Snapshot["scratchpads"][number] | undefined
  let latest = ""
  for (const chat of chats) {
    const ids = [...new Set(chat.messages.flatMap((message) => message.scratchpadIds).reverse())]
    let lastMessage = ""
    for (const message of chat.messages) {
      if (message.createdAt > lastMessage) lastMessage = message.createdAt
    }
    if (lastMessage <= latest) continue
    const scratchpad = ids.map((id) => scratchpads.find((scratchpad) => scratchpad.id === id))
      .find((scratchpad) => scratchpad && (scratchpad.state?.type ?? "topic") === "topic")
    if (!scratchpad) continue
    recent = scratchpad
    latest = lastMessage
  }
  return recent
}
