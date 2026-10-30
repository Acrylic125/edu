import type { z } from "zod"
import type { MaterialSchema } from "./contracts"

export function matchingPresentationPdf(
  presentation: z.infer<typeof MaterialSchema>,
  candidates: z.infer<typeof MaterialSchema>[],
) {
  if (!/\.pptx$/i.test(presentation.name) || !presentation.pages.length) return
  const stem = presentation.name.replace(/\.pptx$/i, "").toLowerCase()
  const matches = candidates.filter((candidate) => {
    if (candidate.kind !== "pdf" || candidate.name.replace(/\.pdf$/i, "").toLowerCase() !== stem || candidate.pages.length !== presentation.pages.length) return false
    // A filename alone cannot establish that slide numbers refer to the same content.
    return presentation.pages.every((page, index) => {
      const words = page.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
      const pdfWords = new Set(candidate.pages[index].toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      return words.length > 0 && words.every((word) => pdfWords.has(word))
    })
  })
  if (matches.length === 1) return matches[0]
}
