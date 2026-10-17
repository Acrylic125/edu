import { z } from "zod"
import { IdSchema, type Snapshot } from "./contracts"

const MaterialLinkSchema = z.object({
  id: IdSchema,
  page: z.coerce.number().int().min(1).max(1000),
})

export function materialCitationNames(name: string) {
  const compact = name.replace(/\s+[-–—]\s+.*(\.[^.]+)$/, "$1")
  if (compact === name) return [name]
  return [name, compact]
}

export function topicSourceMaterials(topic: Snapshot["topics"][number], chats: Snapshot["chats"]) {
  const materials = [
    ...topic.materials,
    ...chats.filter((chat) => chat.messages.some((message) => message.topicIds.includes(topic.id)))
      .flatMap((chat) => chat.materials),
  ]
  return materials.filter((material, index) => materials.findIndex((item) => item.id === material.id) === index)
}

export function resolveMaterialLink(href: string, materials: Snapshot["topics"][number]["materials"]) {
  const direct = /^edu-material:\/\/([^/]+)\/(\d+)$/.exec(href)
  if (direct) {
    const parsed = MaterialLinkSchema.safeParse({ id: direct[1], page: direct[2] })
    if (parsed.success && materials.some((material) => material.id === parsed.data.id)) return parsed.data
    return
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(href)
  } catch {
    return
  }
  const relative = /^assets\/([^/\\#]+)(?:#page=(\d+))?$/.exec(decoded)
  if (!relative) return
  const matching = materials.filter((material) => materialCitationNames(material.name).includes(relative[1]))
  // A filename shared by two tagged topics cannot identify the intended source.
  if (matching.length !== 1) return
  const parsed = MaterialLinkSchema.safeParse({ id: matching[0].id, page: relative[2] ?? 1 })
  if (parsed.success) return parsed.data
}
