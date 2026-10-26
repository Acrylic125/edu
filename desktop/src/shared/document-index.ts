import { z } from "zod"

export const DocumentSectionSchema = z.object({
  id: z.string().regex(/^section-[a-f0-9]{16}-[0-9]+$/),
  title: z.string().trim().min(1).max(1000),
  firstPage: z.number().int().positive(),
  lastPage: z.number().int().positive(),
}).refine((section) => section.lastPage >= section.firstPage, "Section pages must be in source order.")

export const DocumentIndexSchema = z.object({
  version: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  sections: z.array(DocumentSectionSchema).min(1).max(1000),
  ocrPages: z.array(z.number().int().positive()).max(1000),
})
