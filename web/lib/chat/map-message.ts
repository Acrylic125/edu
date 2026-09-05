import type { ChatMessage } from "./types"
import type { ResponseMessage } from "./ws-schema"

export function toChatMessage(message: ResponseMessage) {
  const mapped: ChatMessage = {
    id: message.id,
    role: message.role,
    parts: message.parts,
  }
  if (message.role === "assistant") mapped.status = "complete"
  return mapped
}
