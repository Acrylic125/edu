import type { ChatMessage } from "./types"
import type { ResponseMessage } from "./ws-schema"

export function toChatMessage(message: ResponseMessage) {
  const mapped: ChatMessage = {
    id: message.id,
    role: message.role === "agent" ? "assistant" : "user",
    parts: message.parts,
  }
  if (mapped.role === "assistant") {
    mapped.status = "complete"
  }

  const attachments: NonNullable<ChatMessage["attachments"]> = []
  for (const part of message.parts) {
    if (part.type !== "attachment") {
      continue
    }
    if (!part.url) {
      continue
    }
    attachments.push({
      id: part.ref,
      name: part.filename ?? "image",
      mimeType: part.mimeType ?? "image/jpeg",
      previewUrl: part.url,
    })
  }
  if (attachments.length > 0) {
    mapped.attachments = attachments
  }
  return mapped
}
