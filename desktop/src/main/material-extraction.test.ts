import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createCanvas } from "@napi-rs/canvas"
import { extractMaterial, indexDocument } from "./material-extraction"

test("attachment extraction reuses content hashes and rebuilds malformed cache entries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-extraction-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = await extractMaterial(Buffer.from("6.1 Vector spaces"), ".txt", directory)
  assert.equal(first.text, "6.1 Vector spaces")
  assert.deepEqual(await extractMaterial(Buffer.from("6.1 Vector spaces"), ".txt", directory), first)
  const [entry] = await readdir(directory)
  assert.equal((await readdir(directory)).length, 1)
  await writeFile(join(directory, entry), '{"text":42}')
  assert.deepEqual(await extractMaterial(Buffer.from("6.1 Vector spaces"), ".txt", directory), first)
  assert.equal((await extractMaterial(Buffer.from("6.2 Subspaces"), ".txt", directory)).text, "6.2 Subspaces")
  assert.equal((await readdir(directory)).length, 2)
  await assert.rejects(extractMaterial(Buffer.from([0, 1, 2]), ".txt", directory), /not a readable text file/)
})

test("document indexes retain continuation pages and stable section IDs", () => {
  const pages = ["Cover", "6.1 Vector spaces\nDefinitions", "Examples and continuation", "6.2 Subspaces\nClosure", "More examples"]
  const index = indexDocument("ab".repeat(32), pages, "Lecture.pdf")
  assert.deepEqual(index.sections.map(({ title, firstPage, lastPage }) => ({ title, firstPage, lastPage })), [
    { title: "6.1 Vector spaces", firstPage: 2, lastPage: 3 },
    { title: "6.2 Subspaces", firstPage: 4, lastPage: 5 },
  ])
  assert.deepEqual(indexDocument(index.digest, pages, "Renamed.pdf").sections, index.sections)
})

test("bundled local OCR indexes an image without a model or a language download", { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-ocr-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const canvas = createCanvas(1000, 350)
  const context = canvas.getContext("2d")
  context.fillStyle = "white"
  context.fillRect(0, 0, 1000, 350)
  context.fillStyle = "black"
  context.font = "44px sans-serif"
  context.fillText("6.1 Vector spaces", 40, 80)
  context.font = "30px sans-serif"
  context.fillText("A vector space is closed under addition.", 40, 150)
  const bytes = canvas.toBuffer("image/png")
  const result = await extractMaterial(bytes, ".png", directory)
  assert.match(result.text, /Vector spaces/)
  assert.equal(result.documentIndex?.sections[0].title, "6.1 Vector spaces")
  assert.deepEqual(result.documentIndex?.ocrPages, [1])
  assert.deepEqual(await extractMaterial(bytes, ".png", directory), result)
})
