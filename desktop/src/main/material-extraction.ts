import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createWorker, OEM } from "tesseract.js"
import { createIsomorphicCanvasFactory, extractText, getDocumentProxy, renderPageAsImage } from "unpdf"
import { OfficeGenerator, OfficeParser } from "officeparser"
import { z } from "zod"
import { MaterialSchema } from "../shared/contracts"
import { DocumentIndexSchema } from "../shared/document-index"
import { materialSections } from "../runners/material-sections"

const ExtractedMaterialSchema = MaterialSchema.pick({ kind: true, text: true, pages: true, documentIndex: true })

export function indexDocument(digest: string, pages: string[], name: string, ocrPages: number[] = []) {
  const headings = materialSections({ pages }).filter((heading) => heading.number.includes("."))
  const starts = headings.filter((heading, index) => index === 0 || heading.number !== headings[index - 1].number)
  let sections = starts.map((heading, index) => ({
    id: `section-${digest.slice(0, 16)}-${heading.page}`,
    title: `${heading.number} ${heading.title}`,
    firstPage: heading.page,
    lastPage: (starts[index + 1]?.page ?? pages.length + 1) - 1,
  }))
  if (!sections.length) sections = pages.map((page, index) => ({
    id: `section-${digest.slice(0, 16)}-${index + 1}`,
    title: page.split("\n").find((line) => line.trim())?.trim().slice(0, 160) || name,
    firstPage: index + 1, lastPage: index + 1,
  }))
  return DocumentIndexSchema.parse({ version: 1, digest, sections, ocrPages })
}

export function materialDigest(buffer: Buffer, extension: string) {
  return createHash("sha256").update(buffer).update(`indexed-text-v2:${extension}`).digest("hex")
}

function createOcrWorker(cacheDirectory: string) {
  return createWorker("eng", OEM.LSTM_ONLY, {
    langPath: join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int").replace("app.asar/", "app.asar.unpacked/"),
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js").replace("app.asar/", "app.asar.unpacked/"),
    cachePath: cacheDirectory,
  })
}

export async function readCachedExtraction(buffer: Buffer, extension: string, cacheDirectory: string) {
  const cachePath = join(cacheDirectory, `${materialDigest(buffer, extension)}.json`)
  try {
    return ExtractedMaterialSchema.parse(JSON.parse(await readFile(cachePath, "utf8")))
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
  const ocrPages: number[] = []
  if (extension === ".pdf") {
    kind = "pdf"
    const pdf = await getDocumentProxy(new Uint8Array(buffer), {
      disableFontFace: true,
      CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")),
    })
    try {
      const extracted = await extractText(pdf, { mergePages: false })
      pages = extracted.text
      const missing = pages.flatMap((page, index) => page.trim().length < 80 ? [index] : [])
      if (missing.length) {
        await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
        let next = 0
        const workers = []
        try {
          for (let index = 0; index < Math.min(3, missing.length); index++) {
            const worker = await createOcrWorker(cacheDirectory)
            workers.push(worker)
          }
          const operations = await Promise.allSettled(workers.map(async (worker) => {
            while (next < missing.length) {
              const index = missing[next++]
              const image = await renderPageAsImage(pdf, index + 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.3 })
              const result = await worker.recognize(Buffer.from(image))
              if (result.data.text.trim().length > pages[index].trim().length) {
                pages[index] = result.data.text.trim()
                ocrPages.push(index + 1)
              }
            }
          }))
          const failure = operations.find((result) => result.status === "rejected")
          if (failure?.status === "rejected") throw failure.reason
        } finally {
          await Promise.allSettled(workers.map((worker) => worker.terminate()))
        }
      }
      text = pages.join("\n\n")
    } finally {
      await pdf.loadingTask.destroy()
    }
  } else if (extension === ".pptx") {
    const presentation = await OfficeParser.parseOffice(buffer, {
      fileType: "pptx",
      ignoreSlideMasters: true,
    })
    for (const slide of presentation.content.filter((node) => node.type === "slide")) {
      const extracted = await OfficeGenerator.generate({ ...presentation, content: [slide] }, "text")
      pages.push(extracted.value.trim())
    }
    if (pages.length === 0) throw new Error("The presentation has no readable slides.")
    text = pages.map((page, index) => `Slide ${index + 1}\n${page}`).join("\n\n")
  } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    kind = "image"
    if (buffer.length > 8 * 1024 * 1024) throw new Error("Use images smaller than 8 MB.")
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
    const worker = await createOcrWorker(cacheDirectory)
    try {
      text = (await worker.recognize(buffer)).data.text.trim()
      ocrPages.push(1)
    } finally {
      await worker.terminate()
    }
    if (!text) text = "Image source. Inspect the original image to resolve its content."
  } else {
    if (buffer.includes(0)) throw new Error("The attachment is not a readable text file.")
    text = buffer.toString("utf8")
  }
  const indexedPages = pages.length ? pages : [text]
  const documentIndex = indexDocument(digest, indexedPages, "Source", ocrPages.sort((left, right) => left - right))
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
