import { describe, expect, it, vi } from "vitest"

import { ingestComposerImageFiles, MAX_PDF_BYTES } from "./composer-images"

describe("composer attachments", () => {
  it("accepts PDFs without treating them as images", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "attachment-1" })
    vi.stubGlobal("URL", { createObjectURL: () => "blob:pdf" })
    const file = new File(["%PDF-1.7"], "course.pdf", {
      type: "application/pdf",
    })

    const result = ingestComposerImageFiles([file], [])

    expect(result.error).toBeNull()
    expect(result.nextImages).toContainEqual(
      expect.objectContaining({
        id: "attachment-1",
        name: "course.pdf",
        mimeType: "application/pdf",
      })
    )
  })

  it("rejects PDFs above the upload limit", () => {
    const file = new File([], "large.pdf", { type: "application/pdf" })
    Object.defineProperty(file, "size", { value: MAX_PDF_BYTES + 1 })

    const result = ingestComposerImageFiles([file], [])

    expect(result.nextImages).toEqual([])
    expect(result.error).toContain("20 MB")
  })
})
