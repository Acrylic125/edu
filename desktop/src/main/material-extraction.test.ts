import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { zipSync, strToU8 } from "fflate"
import { createCanvas } from "@napi-rs/canvas"
import { OfficeParser, type OfficeContentNode } from "officeparser"
import { MaterialSchema } from "../shared/contracts"
import { documentPage } from "./document-structure"
import { extractMaterial, indexDocument, materialDigest, readCachedExtraction } from "./material-extraction"

const digest = "ab".repeat(32)

for (const incompatibility of ["absent index", "v1 index", "wrong digest", "wrong page count"] as const) {
  test(`schema-valid extraction cache is rebuilt for ${incompatibility}`, async (t) => {
    // Shape-valid caches need source compatibility checks; malformed JSON cannot exercise those guards.
    const directory = await mkdtemp(join(tmpdir(), "edu-cache-semantic-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const bytes = Buffer.from("6.1 Vector spaces")
    const expected = await extractMaterial(bytes, ".txt", directory)
    let documentIndex = expected.documentIndex
    assert.ok(expected.documentIndex)
    const sourceDigest = materialDigest(bytes, ".txt")
    if (incompatibility === "absent index") {
      documentIndex = undefined
    } else if (incompatibility === "v1 index") {
      documentIndex = { version: 1, digest: sourceDigest, sections: expected.documentIndex.sections, ocrPages: [] }
    } else if (incompatibility === "wrong digest") {
      documentIndex = indexDocument("cd".repeat(32), ["Stale heading"], "Stale.txt")
    } else {
      // Both the map and sections cover two pages, isolating the mismatch with the one-page material.
      documentIndex = indexDocument(sourceDigest, ["Stale first page", "Stale second page"], "Stale.txt")
    }
    const cached = MaterialSchema.pick({ kind: true, text: true, pages: true, documentIndex: true }).parse({
      ...expected, text: "Stale cached extraction", documentIndex,
    })
    const cachePath = join(directory, `${sourceDigest}.json`)
    await writeFile(cachePath, JSON.stringify(cached))
    assert.equal(await readCachedExtraction(bytes, ".txt", directory), undefined)
    assert.deepEqual(await extractMaterial(bytes, ".txt", directory), expected)
    assert.equal(await readFile(cachePath, "utf8"), JSON.stringify(expected))
    assert.deepEqual(await readdir(directory), [`${sourceDigest}.json`])
  })
}

test("attachment extraction reuses the cached value for identical content", async (t) => {
  // A valid cached annotation differs from source text so reparsing cannot masquerade as reuse.
  const directory = await mkdtemp(join(tmpdir(), "edu-extraction-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from("6.1 Vector spaces")
  const first = await extractMaterial(bytes, ".txt", directory)
  assert.equal(first.text, "6.1 Vector spaces")
  const cached = { ...first, text: "Previously extracted text" }
  await writeFile(join(directory, `${materialDigest(bytes, ".txt")}.json`), JSON.stringify(cached))
  assert.deepEqual(await readCachedExtraction(bytes, ".txt", directory), cached)
  assert.deepEqual(await extractMaterial(bytes, ".txt", directory), cached)
  assert.equal((await readdir(directory)).length, 1)
  assert.equal((await extractMaterial(Buffer.from("6.2 Subspaces"), ".txt", directory)).text, "6.2 Subspaces")
  assert.equal((await readdir(directory)).length, 2)
  await assert.rejects(extractMaterial(Buffer.from([0, 1, 2]), ".txt", directory), /not a readable text file/)
})

for (const malformed of ['{"text":42}', '{"text":', '{"kind":"text","text":"stale","pages":[],"documentIndex":{"version":2}}']) {
  test(`malformed cache is rebuilt: ${malformed}`, async (t) => {
    // Invalid JSON and schema-invalid entries must not block extraction or leak stale content.
    const directory = await mkdtemp(join(tmpdir(), "edu-cache-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const bytes = Buffer.from("6.1 Vector spaces")
    const expected = await extractMaterial(bytes, ".txt", directory)
    const cachePath = join(directory, `${materialDigest(bytes, ".txt")}.json`)
    await writeFile(cachePath, malformed)
    assert.equal(await readCachedExtraction(bytes, ".txt", directory), undefined)
    assert.deepEqual(await extractMaterial(bytes, ".txt", directory), expected)
    assert.equal(await readFile(cachePath, "utf8"), JSON.stringify(expected))
    assert.deepEqual(await readdir(directory), [`${materialDigest(bytes, ".txt")}.json`])
  })
}

test("cached v2 indexes with incomplete page coverage are rebuilt", async (t) => {
  // A syntactically valid cache can still omit a source page; v2 coverage validation must reject it.
  const directory = await mkdtemp(join(tmpdir(), "edu-cache-coverage-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from("6.1 Vector spaces")
  const expected = await extractMaterial(bytes, ".txt", directory)
  const cachePath = join(directory, `${materialDigest(bytes, ".txt")}.json`)
  await writeFile(cachePath, JSON.stringify({ ...expected, documentIndex: { ...expected.documentIndex, pageCount: 2 } }))
  assert.equal(await readCachedExtraction(bytes, ".txt", directory), undefined)
  assert.deepEqual(await extractMaterial(bytes, ".txt", directory), expected)
  assert.equal(await readFile(cachePath, "utf8"), JSON.stringify(expected))
})

test("structured extraction invalidates the old OCR/text cache namespace", async (t) => {
  // The old digest contains OCR-era v1 output; reusing it would silently lose the new page map.
  const directory = await mkdtemp(join(tmpdir(), "edu-cache-version-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from("6.1 Vector spaces")
  const oldDigest = createHash("sha256").update(bytes).update("indexed-text-v2:.txt").digest("hex")
  const legacy = JSON.stringify({ kind: "text", text: "Stale OCR output", pages: [], documentIndex: {
    version: 1, digest: oldDigest, sections: [{ id: `section-${oldDigest.slice(0, 16)}-1`, title: "Legacy", firstPage: 1, lastPage: 1 }], ocrPages: [1],
  } })
  await writeFile(join(directory, `${oldDigest}.json`), legacy)
  assert.notEqual(materialDigest(bytes, ".txt"), oldDigest)
  assert.notEqual(materialDigest(bytes, ".txt"), materialDigest(bytes, ".pdf"))
  assert.equal(await readCachedExtraction(bytes, ".txt", directory), undefined)
  const result = await extractMaterial(bytes, ".txt", directory)
  assert.equal(result.text, "6.1 Vector spaces")
  assert.equal(result.documentIndex?.version, 2)
  assert.equal(result.documentIndex?.pageCount, 1)
  assert.deepEqual(result.documentIndex?.ocrPages, [])
  assert.equal(await readFile(join(directory, `${oldDigest}.json`), "utf8"), legacy)
  assert.equal((await readdir(directory)).length, 2)
})

test("indexes cover prefix, continuation, blank, quiz, end and trailing pages exactly once", () => {
  // Covers and terminal slides used to disappear when sections started at the first decimal heading.
  const pages = ["Cover", "6.1 Vector spaces\nDefinitions", "Examples and continuation", "", "Quiz\nAccess via Canvas Quizzes tool", "End of Lecture", "Trailing references"]
  const structure = pages.map((text, offset) => {
    const children: OfficeContentNode[] = [{ type: "paragraph", text }]
    if (offset === 1) children.unshift({ type: "heading", text: "6.1 Vector spaces", metadata: { level: 2 } })
    return documentPage({ type: "page", children }, offset + 1)
  })
  const index = indexDocument(digest, pages, "Lecture.pdf", [], structure)
  assert.equal(index.version, 2)
  assert.equal(index.pageCount, pages.length)
  assert.deepEqual(index.pageMap?.map((page) => page.page), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(index.pageMap?.map((page) => page.blocks.at(-1)?.text), pages)
  assert.deepEqual(index.sections.map(({ firstPage, lastPage }) => [firstPage, lastPage]), [[1, 1], [2, 2], [3, 7]])
  const covered = index.sections.flatMap(({ firstPage, lastPage }) => Array.from({ length: lastPage - firstPage + 1 }, (_, offset) => firstPage + offset))
  assert.deepEqual(covered, [1, 2, 3, 4, 5, 6, 7])
  for (const offset of [0, 2, 3, 4, 5, 6]) {
    assert.equal(index.pageMap?.[offset].headingSource, "unresolved")
    assert.equal(index.pageMap?.[offset].needsVisualReview, true)
  }
  assert.deepEqual(indexDocument(digest, pages, "Renamed.pdf", [], structure).sections, index.sections)
})

test("native top-level, decimal and same-page headings all survive in pageMap", () => {
  // Several headings on one slide must not be collapsed by the legacy single-candidate heuristic.
  const nodes: OfficeContentNode[] = [
    { type: "slide", children: [
      { type: "heading", text: "6 Vector spaces", metadata: { level: 1 } },
      { type: "heading", text: "6.1 Definitions", metadata: { level: 2 } },
      { type: "heading", text: "6.2 Subspaces", metadata: { level: 2 } },
    ] },
    { type: "slide", children: [{ type: "heading", text: "7 Eigenvalues", metadata: { level: 1 } }] },
  ]
  const structure = nodes.map((node, offset) => documentPage(node, offset + 1))
  const index = indexDocument(digest, ["6 Vector spaces\n6.1 Definitions\n6.2 Subspaces", "7 Eigenvalues"], "Lecture.pptx", [], structure)
  assert.deepEqual(index.pageMap, structure)
  assert.deepEqual(index.pageMap?.[0].headings, [
    { text: "6 Vector spaces", level: 1 }, { text: "6.1 Definitions", level: 2 }, { text: "6.2 Subspaces", level: 2 },
  ])
  assert.deepEqual(index.sections.map(({ title, firstPage, lastPage }) => ({ title, firstPage, lastPage })), [
    { title: "6 Vector spaces / 6.1 Definitions / 6.2 Subspaces", firstPage: 1, lastPage: 1 },
    { title: "7 Eigenvalues", firstPage: 2, lastPage: 2 },
  ])
})

test("text fallback retains multiple decimal headings on the same page", () => {
  // Two peer headings previously made the legacy detector discard both, hiding searchable topics.
  const index = indexDocument(digest, ["6.1 Vector spaces\n6.2 Subspaces"], "Notes.txt")
  assert.deepEqual(index.pageMap?.[0].headings, [{ text: "6.1 Vector spaces", level: 2 }, { text: "6.2 Subspaces", level: 2 }])
  assert.equal(index.pageMap?.[0].headingSource, "text")
  assert.equal(index.pageMap?.[0].needsVisualReview, false)
})

test("headingless text continuation pages explicitly remain unresolved", () => {
  // Inheriting 6.1 onto unheaded examples would falsely claim that their heading was extracted.
  const index = indexDocument(digest, ["6.1 Vector spaces", "Worked example without a heading"], "Notes.txt")
  assert.deepEqual(index.pageMap?.[1].headings, [])
  assert.equal(index.pageMap?.[1].headingSource, "unresolved")
  assert.equal(index.pageMap?.[1].needsVisualReview, true)
})

test("headingless native pages remain unresolved instead of inferring headings from text", () => {
  // A bold numbered paragraph and a blank page still need vision when the native AST has no heading.
  const pages = ["6.1 Vector spaces", ""]
  const structure = pages.map((text, offset) => documentPage({ type: "page", children: [{ type: "paragraph", text }] }, offset + 1))
  const index = indexDocument(digest, pages, "Scanned.pdf", [], structure)
  assert.deepEqual(index.pageMap, structure)
  for (const page of index.pageMap ?? []) {
    assert.deepEqual(page.headings, [])
    assert.equal(page.headingSource, "unresolved")
    assert.equal(page.needsVisualReview, true)
  }
  assert.deepEqual(index.sections.map(({ title, firstPage, lastPage }) => ({ title, firstPage, lastPage })), [{ title: "Unclassified pages", firstPage: 1, lastPage: 2 }])
  assert.throws(() => indexDocument(digest, [], "Empty.pdf"), /no pages/)
})

test("reviewed headingless continuation pages extend sections without covering unresolved pages", () => {
  // Vision-confirmed continuation differs from a blank page still awaiting review.
  const structure = [
    documentPage({ type: "page", children: [{ type: "heading", text: "6.1 Vector spaces", metadata: { level: 2 } }] }, 1),
    { ...documentPage({ type: "page", children: [] }, 2), headingSource: "vision" as const, needsVisualReview: false },
    documentPage({ type: "page", children: [] }, 3),
  ]
  const index = indexDocument(digest, ["6.1 Vector spaces", "Worked example", ""], "Lecture.pdf", [], structure)
  assert.deepEqual(index.sections.map(({ firstPage, lastPage }) => [firstPage, lastPage]), [[1, 2], [3, 3]])
  assert.equal(index.pageMap?.[1].needsVisualReview, false)
  assert.equal(index.pageMap?.[2].needsVisualReview, true)
})

for (const extension of [".pdf", ".pptx"] as const) {
  test(`${extension} extraction preserves native AST pages and layout with OCR disabled`, async (t) => {
    // Synthetic native nodes isolate extraction from unavailable PDF/PPTX fixture generators.
    const directory = await mkdtemp(join(tmpdir(), "edu-native-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const ast = await OfficeParser.parseOffice(Buffer.from("Seed"), { fileType: "md", ocr: false })
    let container: "page" | "slide" = "page"
    let fileType: "pdf" | "pptx" = "pdf"
    if (extension === ".pptx") {
      container = "slide"
      fileType = "pptx"
    }
    const content: OfficeContentNode[] = [
      { type: container, children: [{ type: "paragraph", text: "Cover" }] },
      { type: container, children: [
        { type: "heading", text: "6 Vector spaces", metadata: { level: 1 }, bounds: { x: 20, y: 40, width: 300, height: 28 }, formatting: { font: "Arial", size: "24", bold: true } },
        { type: "heading", text: "6.1 Definitions", metadata: { level: 2 } },
        { type: "paragraph", text: "Closed under addition" },
      ] },
      { type: container, children: [] },
      { type: container, children: [{ type: "paragraph", text: "Quiz\nAccess via Canvas Quizzes tool" }] },
      { type: container, children: [{ type: "paragraph", text: "End of Lecture" }] },
      { type: container, children: [{ type: "image", metadata: { attachmentName: "scan.png" } }] },
    ]
    // Native parsers place display text in leaf runs; container text alone is not rendered by OfficeGenerator.
    for (const node of content) {
      for (const child of node.children ?? []) {
        if (child.text) child.children = [{ type: "text", text: child.text }]
      }
    }
    const parse = t.mock.method(OfficeParser, "parseOffice", async (...args: Parameters<typeof OfficeParser.parseOffice>) => {
      assert.deepEqual(args[1], { fileType, ignoreSlideMasters: true, ocr: false })
      return { ...ast, type: fileType, content }
    })
    let bytes = Buffer.from(`Synthetic ${fileType} source`)
    if (extension === ".pptx") {
      // Layout extraction reads OOXML even when the native AST is mocked; empty shapes isolate native preservation.
      const slides = content.map((_, offset) => offset + 1)
      bytes = Buffer.from(zipSync({
        "ppt/presentation.xml": strToU8(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides.map((page) => `<p:sldId id="${255 + page}" r:id="rId${page}"/>`).join("")}</p:sldIdLst></p:presentation>`),
        "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((page) => `<Relationship Id="rId${page}" Target="slides/slide${page}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>`).join("")}</Relationships>`),
        ...Object.fromEntries(slides.map((page) => [`ppt/slides/slide${page}.xml`, strToU8('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>')])),
      }))
    }
    const result = await extractMaterial(bytes, extension, directory)
    assert.equal(parse.mock.callCount(), 1)
    assert.equal(result.kind, extension === ".pdf" ? "pdf" : "text")
    assert.deepEqual(result.pages, ["Cover", "6 Vector spaces\n6.1 Definitions\nClosed under addition", "", "Quiz\nAccess via Canvas Quizzes tool", "End of Lecture", "[Image: scan.png]"])
    assert.equal(result.text, result.pages.join("\n\n"))
    assert.equal(result.documentIndex?.version, 2)
    assert.equal(result.documentIndex?.pageCount, 6)
    assert.deepEqual(result.documentIndex?.pageMap, content.map((node, offset) => documentPage(node, offset + 1)))
    assert.deepEqual(result.documentIndex?.ocrPages, [])
    assert.deepEqual(await extractMaterial(bytes, extension, directory), result)
    assert.equal(parse.mock.callCount(), 1)
  })
}

test("image sources remain explicit vision placeholders without automatic OCR", async (t) => {
  // Readable raster text used to trigger local OCR; it must now stay unresolved for vision.
  const directory = await mkdtemp(join(tmpdir(), "edu-image-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const canvas = createCanvas(1000, 200)
  const context = canvas.getContext("2d")
  context.fillStyle = "white"
  context.fillRect(0, 0, 1000, 200)
  context.fillStyle = "black"
  context.font = "44px sans-serif"
  context.fillText("6.1 Vector spaces", 40, 80)
  const bytes = canvas.toBuffer("image/png")
  const result = await extractMaterial(bytes, ".png", directory)
  assert.equal(result.kind, "image")
  assert.equal(result.text, "Image source. Inspect the original image to resolve its content.")
  assert.deepEqual(result.pages, [])
  assert.equal(result.documentIndex?.pageCount, 1)
  assert.deepEqual(result.documentIndex?.ocrPages, [])
  assert.deepEqual(result.documentIndex?.pageMap?.[0].headings, [])
  assert.equal(result.documentIndex?.pageMap?.[0].headingSource, "unresolved")
  assert.equal(result.documentIndex?.pageMap?.[0].needsVisualReview, true)
  assert.deepEqual(await extractMaterial(bytes, ".png", directory), result)
  assert.deepEqual(await readdir(directory), [`${materialDigest(bytes, ".png")}.json`])
})
