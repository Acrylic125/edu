import { z } from "zod"
import { IdSchema, type Snapshot } from "./contracts"

const MaterialLinkSchema = z.object({
  id: IdSchema,
  page: z.coerce.number().int().min(1).max(1000),
})

function compactMaterialName(name: string) {
  const extension = /\.[^.]+$/.exec(name)?.[0] ?? ""
  const stem = name.slice(0, name.length - extension.length)
    .replace(/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[-_]*)+/i, "")
  let label = stem
  if (!stem || stem.toLowerCase() === extension.slice(1).toLowerCase()) {
    label = "File"
    if (/^\.pptx?$/i.test(extension)) label = "Slides"
    else if (/^\.(pdf|docx?|txt|md)$/i.test(extension)) label = "Document"
    else if (/^\.(png|jpe?g|gif|webp)$/i.test(extension)) label = "Image"
  }
  if (label.length > 32) label = `${label.slice(0, 31).trimEnd()}…`
  return `${label}${extension}`
}

export function materialDisplayName(
  material: Pick<Snapshot["topics"][number]["materials"][number], "id" | "name">,
  materials: Pick<Snapshot["topics"][number]["materials"][number], "id" | "name">[],
) {
  const label = compactMaterialName(material.name)
  const matches = materials.filter((item, index) =>
    compactMaterialName(item.name) === label && materials.findIndex((candidate) => candidate.id === item.id) === index,
  ).sort((left, right) => left.id.localeCompare(right.id))
  if (matches.length < 2) return label
  const index = matches.findIndex((item) => item.id === material.id)
  if (index < 0) return label
  const reserved = new Set(materials.map((item) => compactMaterialName(item.name)))
  let number = 0
  let numbered = label
  for (let position = 0; position <= index; position++) {
    do {
      number++
      numbered = label.replace(/(\.[^.]+)?$/, ` ${number}$1`)
    } while (reserved.has(numbered))
  }
  return numbered
}

export function materialReferenceLabel(
  label: string,
  material: Snapshot["topics"][number]["materials"][number],
  materials: Snapshot["topics"][number]["materials"],
) {
  const name = materialCitationNames(material.name).find((name) => label === name || label.startsWith(`${name},`))
  if (!name) return label
  // Keep useful citation aliases such as "Lecture 6.pdf" while shortening stored filenames.
  if (name !== material.name) return label
  return `${materialDisplayName(material, materials)}${label.slice(name.length)}`
}

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
  const matching = materials.filter((material, index) => materialCitationNames(material.name).includes(relative[1]) &&
    materials.findIndex((candidate) => candidate.id === material.id) === index)
  // A filename shared by two tagged topics cannot identify the intended source.
  if (matching.length !== 1) return
  const parsed = MaterialLinkSchema.safeParse({ id: matching[0].id, page: relative[2] ?? 1 })
  if (parsed.success) return parsed.data
}
