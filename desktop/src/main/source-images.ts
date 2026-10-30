import { randomUUID } from "node:crypto"
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createIsomorphicCanvasFactory, definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import type { z } from "zod"
import type { MaterialSchema } from "../shared/contracts"

// Extraction and rendering must share PDF.js; its process-global worker cannot mix versions.
const pdfRuntime = definePDFJSModule(async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs").replace("app.asar/", "app.asar.unpacked/")).href
  return pdfjs
})

// PDF.js classifies Electron utility processes as browsers. Match its Node factory so
// luminosity and alpha masks use pixel conversion instead of SVG filters needing document.URL.
class NodeCanvasFilterFactory {
  addFilter() { return "none" }
  addHCMFilter() { return "none" }
  addAlphaFilter() { return "none" }
  addLuminosityFilter() { return "none" }
  addKnockoutFilter() { return "none" }
  addHighlightHCMFilter() { return "none" }
  addSelectionHCMFilter() { return "none" }
  addSelectionFilter() { return "none" }
  createSelectionStyle() { return null }
  destroy() {}
}

const renderVersion = "node-canvas-filters-v2"
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function readSourceImages(
  material: Pick<z.infer<typeof MaterialSchema>, "id" | "name" | "kind">,
  directory: string,
  firstPage: number,
  lastPage: number,
) {
  if (material.kind !== "pdf" && material.kind !== "image") {
    throw new Error("Screenshots require a PDF or image attachment. PPTX uses native text and layout; attach a PDF export when slide images are needed.")
  }
  const sourcePath = join(directory, material.name)
  const sourceStat = await stat(sourcePath)
  const cachedPages = await Promise.all(
    Array.from({ length: lastPage - firstPage + 1 }, async (_, index) => {
      const path = join(directory, `source-${material.id}-${firstPage + index}.png`)
      try {
        if (await readFile(`${path}.version`, "utf8") !== renderVersion) return
        if ((await stat(path)).mtimeMs < sourceStat.mtimeMs) return
        const png = await readFile(path)
        if (png.subarray(0, 8).equals(pngSignature)) return png
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      }
    }),
  )
  let bytes: Buffer | undefined
  if (cachedPages.some((png) => !png)) bytes = await readFile(sourcePath)
  await pdfRuntime
  const pdf = material.kind === "pdf" && bytes
    ? await getDocumentProxy(new Uint8Array(bytes), {
        // Electron has no DOM font loader; unpdf's CommonJS entry drops its Node defaults.
        disableFontFace: true,
        CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")),
        FilterFactory: NodeCanvasFilterFactory,
      })
    : undefined
  const images: Buffer[] = []
  try {
    for (let page = firstPage; page <= lastPage; page++) {
      let png = cachedPages[page - firstPage]
      if (!png) {
        if (pdf) {
          png = Buffer.from(await renderPageAsImage(pdf, page, {
            canvasImport: () => import("@napi-rs/canvas"),
            scale: 1.3,
          }))
        } else {
          if (!bytes) throw new Error("Source image is unavailable.")
          const source = await loadImage(bytes)
          const scale = Math.min(1, 1600 / Math.max(source.width, source.height))
          const canvas = createCanvas(
            Math.max(1, Math.round(source.width * scale)),
            Math.max(1, Math.round(source.height * scale)),
          )
          canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height)
          png = Buffer.from(canvas.toBuffer("image/png"))
        }
        const path = join(directory, `source-${material.id}-${page}.png`)
        const temporary = `${path}.${randomUUID()}.tmp`
        try {
          // The UI and tutor worker can render the same page concurrently.
          await writeFile(temporary, png, { mode: 0o600 })
          await rename(temporary, path)
        } finally {
          await rm(temporary, { force: true })
        }
        await writeFile(`${path}.version`, renderVersion, { mode: 0o600 })
      }
      images.push(png)
    }
    return images
  } finally {
    await pdf?.loadingTask.destroy()
  }
}
