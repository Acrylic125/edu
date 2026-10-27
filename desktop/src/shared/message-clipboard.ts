import { z } from "zod"
import { MaterialDraftIdsSchema, MessageSchema, type Chat } from "./contracts"

export const CopiedMessageSchema = z.object({
  text: MessageSchema.shape.content,
  materialIds: MaterialDraftIdsSchema.default([]),
})

export function messageClipboardHtml(text: string, materialIds: string[]) {
  const ids = MaterialDraftIdsSchema.parse(materialIds).join(",")
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  return `<div data-edu-materials="${ids}" style="white-space: pre-wrap">${escaped}</div>`
}

export function clipboardMaterialIds(html: string) {
  const match = /<div\s+data-edu-materials="([a-f0-9,-]+)"/i.exec(html)
  if (!match) return []
  const parsed = MaterialDraftIdsSchema.safeParse(match[1].split(","))
  if (parsed.success) return parsed.data
  return []
}

export function messageCopyText(message: Chat["messages"][number], text: string) {
  if (message.role !== "user" || !message.materialIds?.length) return text
  return text.replace(/^Help me (work with|understand) the attached materials: [^\n]+\.$/, "Help me $1 the attached materials.")
}
