import { z } from "zod"

export const ContentBlockIdSchema = z.string().min(1).max(150).regex(/^[a-zA-Z0-9-]+$/)
const BlockTargetSchema = z.object({ id: ContentBlockIdSchema, sectionId: z.string().min(1).max(150).optional() })
export const ContentBlockSchema = z.discriminatedUnion("type", [
  BlockTargetSchema.extend({ type: z.literal("markdown"), content: z.array(z.string().max(50_000)).min(1).max(2000) }),
  BlockTargetSchema.extend({ type: z.literal("source"), materialId: z.uuid(), page: z.number().int().positive(), presentation: z.enum(["link", "image"]).default("link") }),
  z.object({ type: z.literal("term"), id: ContentBlockIdSchema, term: z.string().trim().min(1).max(1000), meaning: z.string().trim().min(1).max(10_000) }),
])
export const ContentDocumentSchema = z.object({ version: z.literal(1), blocks: z.array(ContentBlockSchema).max(2000) }).superRefine((document, ctx) => {
  if (new Set(document.blocks.map((block) => block.id)).size !== document.blocks.length)
    ctx.addIssue({ code: "custom", message: "Content block IDs must be unique." })
})
export const ContentChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), block: ContentBlockSchema, afterId: ContentBlockIdSchema.nullable().optional() }),
  z.object({ action: z.literal("edit"), block: ContentBlockSchema }),
  z.object({ action: z.literal("delete"), id: ContentBlockIdSchema }),
])
export const ContentChangesSchema = z.array(ContentChangeSchema).min(1).max(100)

export function applyContentChanges(document: z.infer<typeof ContentDocumentSchema>, changes: z.infer<typeof ContentChangesSchema>) {
  const next = structuredClone(document)
  for (const change of changes) {
    let id: string
    if (change.action === "delete") id = change.id
    else id = change.block.id
    const index = next.blocks.findIndex((block) => block.id === id)
    if (change.action === "add") {
      if (index !== -1) throw new Error(`Content block already exists: ${id}`)
      let position = next.blocks.length
      if (change.afterId === null) position = 0
      else if (change.afterId !== undefined) {
        const after = next.blocks.findIndex((block) => block.id === change.afterId)
        if (after === -1) throw new Error(`Content block not found: ${change.afterId}`)
        position = after + 1
      } else if ("sectionId" in change.block && change.block.sectionId) {
        const sectionId = change.block.sectionId
        const last = next.blocks.findLastIndex((block) => "sectionId" in block && block.sectionId === sectionId)
        if (last !== -1) position = last + 1
      }
      next.blocks.splice(position, 0, change.block)
    } else {
      if (index === -1) throw new Error(`Content block not found: ${id}`)
      if (change.action === "edit") next.blocks[index] = change.block
      else next.blocks.splice(index, 1)
    }
  }
  return ContentDocumentSchema.parse(next)
}
