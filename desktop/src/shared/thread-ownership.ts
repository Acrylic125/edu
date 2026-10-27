import type { Chat } from "./contracts"

export function isStagedChat(chat: Pick<Chat, "ownerScratchpadId" | "scratchpadRequested">) {
  return chat.scratchpadRequested && !chat.ownerScratchpadId
}

export function chatScratchpadId(chat: Pick<Chat, "ownerScratchpadId" | "messages">, fileBackedScratchpadIds: ReadonlySet<string>) {
  let id = chat.ownerScratchpadId
  if (!id) {
    // The host adds scratchpad IDs to assistant messages only when it publishes creations.
    id = chat.messages.find((message) => message.role === "assistant" && message.scratchpadIds.length > 0)?.scratchpadIds[0]
  }
  if (id && fileBackedScratchpadIds.has(id)) return id
}
