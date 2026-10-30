import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { readSourceImages } from "../src/main/source-images"
import { softMaskPdfFixture } from "./document-fixtures"
import { z } from "zod"

async function main() {
  assert.equal(process.type, "utility")
  assert.equal(typeof document, "undefined")
  const directory = process.argv[2]
  assert.ok(directory)
  await writeFile(join(directory, "soft-mask.pdf"), softMaskPdfFixture())
  const material = { id: "soft-mask", name: "soft-mask.pdf", kind: "pdf" as const }
  const [png] = await readSourceImages(material, directory, 1, 1)
  const bitmap = await loadImage(png)
  const canvas = createCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext("2d")
  context.drawImage(bitmap, 0, 0)
  // White mask pixels expose the red drawing; black mask pixels leave the white page visible.
  assert.deepEqual([...context.getImageData(20, 20, 1, 1).data], [255, 0, 0, 255])
  assert.deepEqual([...context.getImageData(bitmap.width - 20, 20, 1, 1).data], [255, 255, 255, 255])
  const [cached] = await readSourceImages(material, directory, 1, 1)
  assert.deepEqual(cached, png)
  await writeFile(join(directory, "rendered.png"), png)
  assert.ok((await readFile(join(directory, "source-soft-mask-1.png.version"), "utf8")).length)
  if (process.argv[3]) {
    const firstPage = z.coerce.number().int().positive().parse(process.argv[4] ?? "1")
    const lastPage = z.coerce.number().int().min(firstPage).parse(process.argv[5] ?? firstPage)
    await writeFile(join(directory, "original.pdf"), await readFile(process.argv[3]))
    const images = await readSourceImages({ id: "original", name: "original.pdf", kind: "pdf" }, directory, firstPage, lastPage)
    assert.equal(images.length, lastPage - firstPage + 1)
    for (const png of images) assert.ok(png.length > 100)
    if (process.argv[6]) {
      const page = z.coerce.number().int().min(firstPage).max(lastPage).parse(process.argv[7] ?? firstPage)
      await writeFile(process.argv[6], images[page - firstPage])
    }
    console.log(`PASS: Original PDF pages ${firstPage}–${lastPage} rendered in the Electron utility process.`)
  }
  process.parentPort.postMessage({ type: "passed" })
}
main().catch((error: Error) => { console.error(error.stack); process.exit(1) })
