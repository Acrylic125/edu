import type { OfficeContentNode } from "officeparser"
import { z } from "zod"
import { DocumentBlockSchema, DocumentPageSchema } from "../shared/document-index"

export function documentPage(node: OfficeContentNode, page: number) {
  const blocks: z.infer<typeof DocumentBlockSchema>[] = []
  function visit(nodes: OfficeContentNode[], depth: number) {
    for (const child of nodes) {
      let level: number | undefined
      if (child.type === "heading") level = child.metadata?.level ?? 1
      const block: z.infer<typeof DocumentBlockSchema> = { type: child.type, text: child.text ?? "", depth }
      if (level !== undefined) block.level = level
      if (child.bounds) block.bounds = child.bounds
      if (child.formatting?.font !== undefined) block.font = child.formatting.font
      if (child.formatting?.size !== undefined) block.size = child.formatting.size
      if (child.formatting?.bold !== undefined) block.bold = child.formatting.bold
      blocks.push(block)
      visit(child.children ?? [], depth + 1)
      visit(child.notes ?? [], depth + 1)
    }
  }
  visit(node.children ?? [], 0)
  visit(node.notes ?? [], 0)
  const headings = blocks.filter((block) => block.type === "heading" && block.text.trim()).map((block) => ({ text: block.text.trim().slice(0, 1000), level: block.level ?? 1 }))
  let width: number | undefined
  let height: number | undefined
  if (node.type === "page") {
    width = node.metadata?.pageWidth
    height = node.metadata?.pageHeight
  }
  let headingSource: z.infer<typeof DocumentPageSchema>["headingSource"] = "unresolved"
  if (headings.length) headingSource = "structure"
  // Overprinted glyphs can yield duplicated letters in extracted PDF headings; inspect their pixels.
  const ambiguous = headings.some((heading) => /(?:([A-Za-z])\1){4}/.test(heading.text))
  const result = DocumentPageSchema.parse({ page, blocks, headings, headingSource, needsVisualReview: !headings.length || ambiguous })
  if (width !== undefined) result.width = width
  if (height !== undefined) result.height = height
  return result
}
