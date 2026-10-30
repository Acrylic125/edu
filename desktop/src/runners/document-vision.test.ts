import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { createVisionFixture } from "../../test/document-fixtures"
import { z } from "zod"
import { indexDocument } from "../main/material-extraction"
import { applyVisualReview, reviewDocumentWithCodex } from "./document-vision"

test("visual review preserves native blocks and resolves only inspected pages", () => {
  // Page 1 is native; pages 2 and 3 are unresolved. Reviewing page 2 must leave page 3 pending.
  const index = indexDocument("ab".repeat(32), ["1. Introduction", "", ""], "Source")
  const result = applyVisualReview(index, ["1. Introduction", "", ""], { pages: [{ page: 2, headings: [] }] })
  assert.deepEqual(result.pageMap?.[0], index.pageMap?.[0])
  assert.deepEqual(result.pageMap?.[1].blocks, index.pageMap?.[1].blocks)
  assert.equal(result.pageMap?.[1].headingSource, "vision")
  assert.equal(result.pageMap?.[1].needsVisualReview, false)
  assert.equal(result.pageMap?.[2].needsVisualReview, true)
  assert.deepEqual(result.sections.map(({ firstPage, lastPage }) => [firstPage, lastPage]), [[1, 2], [3, 3]])
  assert.throws(() => applyVisualReview(index, ["1. Introduction", "", ""], { pages: [{ page: 2, headings: [] }, { page: 2, headings: [] }] }), /duplicate/)
  assert.throws(() => applyVisualReview(index, ["1. Introduction", "", ""], { pages: [{ page: 4, headings: [] }] }), /out-of-range/)
})

for (const count of [8, 9]) {
  test(`${count} unresolved pages produce batches of at most eight PNGs and a reusable visual cache`, { timeout: 15_000 }, async (t) => {
    // Real small PDF pages exercise image delivery; the external model boundary alone is deterministic.
    const source = await createVisionFixture(count)
    t.after(() => rm(source.directory, { recursive: true, force: true }))
    const result = await reviewDocumentWithCodex(source.material, source.directory, source.connection, "test", source.cache)
    const calls = (await readFile(source.log, "utf8")).trim().split("\n").map((line: string) => z.object({ pages: z.array(z.number()), images: z.array(z.object({ type: z.string(), detail: z.string(), png: z.boolean(), url: z.string() })) }).parse(JSON.parse(line)))
    assert.deepEqual(calls.map((call) => call.pages), [Array.from({ length: 8 }, (_, i) => i + 1), ...Array.from({ length: count - 8 }, () => [9])])
    assert.ok(calls.every((call) => call.images.length === call.pages.length && call.images.every((image) => image.png && image.detail === "high")))
    // Each physical PDF page has a distinct known background, so blank or wrong-page images fail.
    for (const call of calls) {
      for (const [offset, image] of call.images.entries()) {
        const bitmap = await loadImage(Buffer.from(image.url.split(",")[1], "base64"))
        const canvas = createCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext("2d")
        context.drawImage(bitmap, 0, 0)
        const pixel = context.getImageData(5, 5, 1, 1).data
        const expected = [Math.round((call.pages[offset] - 1) / count * 255), 204, 128]
        for (const [channel, value] of expected.entries()) assert.ok(Math.abs(pixel[channel] - value) <= 1, `page ${call.pages[offset]} channel ${channel}: expected ${value}, received ${pixel[channel]}`)
      }
    }
    assert.equal(result.index.pageMap?.filter((page) => page.needsVisualReview).length, 0)
    assert.deepEqual(result.index.pageMap?.map((page) => page.headings[0].text), Array.from({ length: count }, (_, i) => `Heading ${i + 1}`))
    assert.equal(result.batches.length, Math.ceil(count / 8))
    assert.ok(result.batches.every((batch) => batch.inputTokens === 100 && batch.outputTokens === 20))
    await rm(source.executable)
    const cached = await reviewDocumentWithCodex(source.material, source.directory, source.connection, "test", source.cache)
    assert.equal(cached.cached, true)
    assert.deepEqual(cached.index, result.index)
    assert.deepEqual(cached.batches, [])
    await assert.rejects(reviewDocumentWithCodex(source.material, source.directory, source.connection, "different-model", source.cache), /could not start/)
  })
}

for (const response of ["missing", "duplicate", "unrequested", "invalid-heading", "malformed", "failed"]) {
  test(`invalid visual response '${response}' fails without publishing an index cache`, { timeout: 10_000 }, async (t) => {
    // Rejected model output must not become a complete-looking, durable navigation index.
    const source = await createVisionFixture(1, response)
    t.after(() => rm(source.directory, { recursive: true, force: true }))
    await assert.rejects(reviewDocumentWithCodex(source.material, source.directory, source.connection, "test", source.cache))
    assert.equal((await readdir(source.directory)).includes("cache"), false)
    assert.equal(source.material.documentIndex.pageMap?.[0].needsVisualReview, true)
  })
}

test("a matching-model v1 visual cache cannot hide an unresolved page", { timeout: 10_000 }, async (t) => {
  // Legacy section-only caches lack evidence that every physical page was inspected.
  const source = await createVisionFixture(1)
  t.after(() => rm(source.directory, { recursive: true, force: true }))
  await mkdir(source.cache)
  const key = createHash("sha256").update(`${source.material.documentIndex.digest}:test:visual-headings-v1`).digest("hex")
  await writeFile(join(source.cache, `${key}.vision.json`), JSON.stringify({ model: "test", index: { version: 1, digest: source.material.documentIndex.digest, sections: source.material.documentIndex.sections, ocrPages: [] } }))
  const result = await reviewDocumentWithCodex(source.material, source.directory, source.connection, "test", source.cache)
  assert.equal(result.cached, false)
  assert.equal(result.index.version, 2)
  assert.equal(result.index.pageMap?.[0].headingSource, "vision")
})
