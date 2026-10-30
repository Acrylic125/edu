import { z } from "zod"

export const DocumentBlockSchema = z.object({
  type: z.string(),
  text: z.string(),
  depth: z.number().int().nonnegative(),
  level: z.number().int().positive().optional(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  font: z.string().optional(),
  size: z.string().optional(),
  bold: z.boolean().optional(),
})

export const DocumentHeadingSchema = z.object({ text: z.string().trim().min(1).max(1000), level: z.number().int().min(1).max(20) })
export const DocumentPageSchema = z.object({
  page: z.number().int().positive(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  blocks: z.array(DocumentBlockSchema),
  headings: z.array(DocumentHeadingSchema),
  headingSource: z.enum(["structure", "text", "vision", "unresolved"]),
  needsVisualReview: z.boolean(),
})

export const DocumentVisualReviewSchema = z.object({
  pages: z.array(z.object({ page: z.number().int().positive(), headings: z.array(DocumentHeadingSchema) })).min(1),
})

export const DocumentSectionSchema = z.object({
  id: z.string().regex(/^section-[a-f0-9]{16}-[0-9]+$/),
  title: z.string().trim().min(1).max(1000),
  firstPage: z.number().int().positive(),
  lastPage: z.number().int().positive(),
}).refine((section) => section.lastPage >= section.firstPage, "Section pages must be in source order.")

export const DocumentIndexSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  sections: z.array(DocumentSectionSchema).min(1).max(1000),
  ocrPages: z.array(z.number().int().positive()).max(1000),
  pageCount: z.number().int().positive().max(1000).optional(),
  pageMap: z.array(DocumentPageSchema).max(1000).optional(),
}).superRefine((index, context) => {
  if (index.version !== 2) return
  if (!index.pageCount || index.pageMap?.length !== index.pageCount) {
    context.addIssue({ code: "custom", message: "A v2 index must retain every source page." })
    return
  }
  if (index.pageMap.some((page, offset) => page.page !== offset + 1))
    context.addIssue({ code: "custom", message: "Source pages must be in order without gaps." })
  let nextPage = 1
  const ids = new Set<string>()
  for (const section of index.sections) {
    if (section.firstPage !== nextPage || section.lastPage > index.pageCount || ids.has(section.id))
      context.addIssue({ code: "custom", message: "Section ranges must cover every page exactly once with unique IDs." })
    ids.add(section.id)
    nextPage = section.lastPage + 1
  }
  if (nextPage !== index.pageCount + 1)
    context.addIssue({ code: "custom", message: "Section ranges must include the final source page." })
})
