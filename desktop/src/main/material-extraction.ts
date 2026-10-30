import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { OfficeGenerator, OfficeParser } from "officeparser"
import { z } from "zod"
import { MaterialSchema } from "../shared/contracts"
import { DocumentIndexSchema, DocumentPageSchema } from "../shared/document-index"
import { documentPage } from "./document-structure"
import { presentationLayout } from "./presentation-layout"

const ExtractedMaterialSchema = MaterialSchema.pick({ kind: true, text: true, pages: true, documentIndex: true })

export function indexDocument(digest: string, pages: string[], name: string, ocrPages: number[] = [], structure?: z.infer<typeof DocumentPageSchema>[]) {
  if (!pages.length) throw new Error("The source has no pages.")
  const pageMap = structure ?? pages.map((text, offset) => {
    const headings = []
    for (const line of text.split("\n")) {
      const heading = /^([1-9]\d{0,2}\.|[1-9]\d{0,2}(?:\.\d{1,3})+\.?)\s+(.+)/.exec(line.trim())
      if (!heading || !/^(?:\p{L}|\d+\p{L}|\d+['’])/u.test(heading[2]) || /[=×÷+*<>]/.test(heading[2])) continue
      const number = heading[1].replace(/\.$/, "")
      headings.push({ text: `${number} ${heading[2]}`, level: number.split(".").length })
    }
    let headingSource: z.infer<typeof DocumentPageSchema>["headingSource"] = "unresolved"
    if (headings.length) headingSource = "text"
    return { page: offset + 1, blocks: [{ type: "paragraph", text, depth: 0 }], headings, headingSource, needsVisualReview: !headings.length }
  })
  const sections: z.infer<typeof DocumentIndexSchema>["sections"] = []
  for (const page of pageMap) {
    let title = `Unclassified pages`
    if (page.headings.length) title = page.headings.map((heading) => heading.text).join(" / ").slice(0, 1000)
    const previous = sections.at(-1)
    // Reviewed headingless pages can continue a section; unresolved pages remain visible as gaps.
    if (previous && (previous.title === title || (!page.headings.length && !page.needsVisualReview))) {
      previous.lastPage = page.page
    } else {
      sections.push({ id: `section-${digest.slice(0, 16)}-${page.page}`, title, firstPage: page.page, lastPage: page.page })
    }
  }
  return DocumentIndexSchema.parse({ version: 2, digest, sections, ocrPages, pageCount: pages.length, pageMap })
}

export function materialDigest(buffer: Buffer, extension: string) {
  return createHash("sha256").update(buffer).update(`structured-pages-v4:${extension}`).digest("hex")
}

export async function readCachedExtraction(buffer: Buffer, extension: string, cacheDirectory: string) {
  const cachePath = join(cacheDirectory, `${materialDigest(buffer, extension)}.json`)
  try {
    const cached = ExtractedMaterialSchema.parse(JSON.parse(await readFile(cachePath, "utf8")))
    if (cached.documentIndex?.version !== 2 || cached.documentIndex.digest !== materialDigest(buffer, extension) || cached.documentIndex.pageCount !== (cached.pages.length || 1)) return
    return cached
  } catch (error) {
    if (!(error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT"))) throw error
  }
}

export async function extractMaterial(buffer: Buffer, extension: string, cacheDirectory: string) {
  const digest = materialDigest(buffer, extension)
  const cachePath = join(cacheDirectory, `${digest}.json`)
  const cached = await readCachedExtraction(buffer, extension, cacheDirectory)
  if (cached) return cached
  let text = ""
  let pages: string[] = []
  let kind: z.infer<typeof MaterialSchema>["kind"] = "text"
  let structure: z.infer<typeof DocumentPageSchema>[] | undefined
  if (extension === ".pdf" || extension === ".pptx") {
    let fileType: "pdf" | "pptx" = "pdf"
    if (extension === ".pptx") fileType = "pptx"
    const worker = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
    let pdfWorkerSrc: string | undefined
    if (worker.includes("app.asar/")) pdfWorkerSrc = pathToFileURL(worker.replace("app.asar/", "app.asar.unpacked/")).href
    const document = await OfficeParser.parseOffice(buffer, { fileType, ignoreSlideMasters: true, ocr: false, ...(pdfWorkerSrc ? { pdfWorkerSrc } : {}) })
    const containers = document.content.filter((node) => node.type === "page" || node.type === "slide")
    if (!containers.length) throw new Error("The document has no readable pages or slides.")
    structure = containers.map((node, offset) => documentPage(node, offset + 1))
    if (extension === ".pptx") {
      const layout = presentationLayout(buffer)
      if (layout.length !== structure.length) throw new Error("The slide manifest and extracted slide count disagree.")
      structure = structure.map((page, offset) => ({ ...page, ...layout[offset], blocks: [...page.blocks, ...layout[offset].blocks] }))
    }
    for (const node of containers) {
      const extracted = await OfficeGenerator.generate({ ...document, content: [node] }, "text")
      pages.push(extracted.value.trim())
    }
    if (extension === ".pdf") kind = "pdf"
    text = pages.join("\n\n")
  } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    kind = "image"
    if (buffer.length > 8 * 1024 * 1024) throw new Error("Use images smaller than 8 MB.")
    text = "Image source. Inspect the original image to resolve its content."
  } else {
    if (buffer.includes(0)) throw new Error("The attachment is not a readable text file.")
    text = buffer.toString("utf8")
  }
  const indexedPages = pages.length ? pages : [text]
  const documentIndex = indexDocument(digest, indexedPages, "Source", [], structure)
  const result = ExtractedMaterialSchema.parse({ kind, text, pages, documentIndex })
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
  const temporary = `${cachePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(result), { mode: 0o600 })
    await rename(temporary, cachePath)
  } finally {
    await rm(temporary, { force: true })
  }
  return result
}
