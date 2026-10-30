import assert from "node:assert/strict"
import { test } from "node:test"
import type { OfficeContentNode } from "officeparser"
import { documentPage } from "./document-structure"

test("PPTX slide-root speaker notes survive after slide content with their nested runs", () => {
  // OfficeParser attaches speaker notes to the slide itself, outside its children.
  const slide: OfficeContentNode = {
    type: "slide", metadata: { slideNumber: 4 },
    children: [{ type: "heading", text: "7 Eigenvalues", metadata: { level: 1 } }],
    notes: [{ type: "note", children: [
      { type: "paragraph", text: "Explain repeated eigenvalues", children: [
        { type: "text", text: "Explain repeated eigenvalues", formatting: { bold: true } },
      ] },
    ] }],
  }
  const page = documentPage(slide, 4)
  assert.equal(page.page, 4)
  assert.deepEqual(page.blocks, [
    { type: "heading", text: "7 Eigenvalues", depth: 0, level: 1 },
    { type: "note", text: "", depth: 0 },
    { type: "paragraph", text: "Explain repeated eigenvalues", depth: 1 },
    { type: "text", text: "Explain repeated eigenvalues", depth: 2, bold: true },
  ])
  assert.deepEqual(page.headings, [{ text: "7 Eigenvalues", level: 1 }])
  assert.equal(page.headingSource, "structure")
  assert.equal(page.needsVisualReview, false)
})

test("ambiguous PDF headings with duplicated glyphs retain native evidence and require vision", () => {
  // Overprinted PDF glyphs can look like a native heading while corrupting its extracted text.
  const text = "VVeeccttoorr ssppaacceess"
  const page = documentPage({ type: "page", children: [
    { type: "heading", text, metadata: { level: 2 }, bounds: { x: 20, y: 30, width: 300, height: 24 } },
    { type: "paragraph", text: "Closed under addition" },
  ] }, 2)
  assert.deepEqual(page.headings, [{ text, level: 2 }])
  assert.deepEqual(page.blocks, [
    { type: "heading", text, depth: 0, level: 2, bounds: { x: 20, y: 30, width: 300, height: 24 } },
    { type: "paragraph", text: "Closed under addition", depth: 0 },
  ])
  assert.equal(page.headingSource, "structure")
  assert.equal(page.needsVisualReview, true)
})

test("PDF AST preserves heading levels, page geometry, bounds and typography", () => {
  // A top-level title beside a decimal subtitle must survive without flattening away PDF layout.
  const node: OfficeContentNode = {
    type: "page",
    metadata: { pageNumber: 3, pageWidth: 612, pageHeight: 792 },
    children: [
      { type: "heading", text: " 6 Vector spaces ", metadata: { level: 1 },
        bounds: { x: 30, y: 40, width: 300, height: 28 },
        formatting: { font: "Helvetica", size: "24", bold: true } },
      { type: "heading", text: "6.1 Subspaces", metadata: { level: 2 } },
      { type: "paragraph", text: "Closure under addition", bounds: { x: 30, y: 100, width: 400, height: 16 },
        formatting: { font: "Helvetica", size: "12", bold: false } },
    ],
  }
  const page = documentPage(node, 3)
  assert.equal(page.page, 3)
  assert.equal(page.width, 612)
  assert.equal(page.height, 792)
  assert.deepEqual(page.headings, [{ text: "6 Vector spaces", level: 1 }, { text: "6.1 Subspaces", level: 2 }])
  assert.equal(page.headingSource, "structure")
  assert.equal(page.needsVisualReview, false)
  assert.deepEqual(page.blocks[0], {
    type: "heading", text: " 6 Vector spaces ", depth: 0, level: 1,
    bounds: { x: 30, y: 40, width: 300, height: 28 }, font: "Helvetica", size: "24", bold: true,
  })
  assert.deepEqual(page.blocks[2].bounds, { x: 30, y: 100, width: 400, height: 16 })
  assert.equal(page.blocks[2].bold, false)
})

test("PPTX AST preserves nested text, tables and attached notes in source order", () => {
  // Slide tables and nested text carry content that a heading-only extraction would discard.
  const slide: OfficeContentNode = {
    type: "slide", metadata: { slideNumber: 2 }, children: [
      { type: "heading", text: "7 Eigenvalues", children: [{ type: "text", text: "7 Eigenvalues", formatting: { bold: true } }] },
      { type: "table", children: [{ type: "row", children: [{ type: "cell", children: [{ type: "paragraph", text: "lambda = 2" }] }] }],
        notes: [{ type: "note", text: "Explain the diagonal case" }] },
    ],
  }
  const page = documentPage(slide, 2)
  assert.deepEqual(page.headings, [{ text: "7 Eigenvalues", level: 1 }])
  assert.deepEqual(page.blocks.map(({ type, text, depth }) => ({ type, text, depth })), [
    { type: "heading", text: "7 Eigenvalues", depth: 0 },
    { type: "text", text: "7 Eigenvalues", depth: 1 },
    { type: "table", text: "", depth: 0 },
    { type: "row", text: "", depth: 1 },
    { type: "cell", text: "", depth: 2 },
    { type: "paragraph", text: "lambda = 2", depth: 3 },
    { type: "note", text: "Explain the diagonal case", depth: 1 },
  ])
  assert.equal(page.headingSource, "structure")
  assert.equal(page.needsVisualReview, false)
})

test("blank and headingless AST pages explicitly require visual review", () => {
  // Neither an empty page nor numbered body text is evidence of a native heading.
  for (const children of [[], [{ type: "paragraph", text: "6.1 Looks like a heading", formatting: { bold: true } }], [{ type: "heading", text: "   " }]] satisfies OfficeContentNode[][]) {
    const page = documentPage({ type: "page", children }, 1)
    assert.deepEqual(page.headings, [])
    assert.equal(page.headingSource, "unresolved")
    assert.equal(page.needsVisualReview, true)
    assert.equal(page.blocks.length, children.length)
  }
})
