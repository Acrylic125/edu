import assert from "node:assert/strict"
import { test } from "node:test"
import { DocumentIndexSchema, DocumentPageSchema } from "./document-index"

const digest = "ab".repeat(32)
// Three independently enumerated pages expose middle gaps and terminal omissions separately.
const valid = {
  version: 2,
  digest,
  pageCount: 3,
  pageMap: [1, 2, 3].map((page) => DocumentPageSchema.parse({
    page, blocks: [], headings: [], headingSource: "unresolved", needsVisualReview: true,
  })),
  sections: [
    { id: `section-${digest.slice(0, 16)}-1`, title: "Opening", firstPage: 1, lastPage: 1 },
    { id: `section-${digest.slice(0, 16)}-2`, title: "Body and ending", firstPage: 2, lastPage: 3 },
  ],
  ocrPages: [],
}

test("v2 accepts a complete ordered page map and contiguous sections", () => {
  assert.deepEqual(DocumentIndexSchema.parse(valid), valid)
})

const invalidIndexes = [
  { name: "absent page count", value: { ...valid, pageCount: undefined } },
  { name: "absent page map", value: { ...valid, pageMap: undefined } },
  { name: "missing middle map page", value: { ...valid, pageMap: [valid.pageMap[0], valid.pageMap[2]] } },
  { name: "duplicate map page", value: { ...valid, pageMap: [valid.pageMap[0], valid.pageMap[0], valid.pageMap[2]] } },
  { name: "reordered map pages", value: { ...valid, pageMap: [valid.pageMap[1], valid.pageMap[0], valid.pageMap[2]] } },
  { name: "map page beyond physical count", value: { ...valid, pageMap: [valid.pageMap[0], valid.pageMap[1], { ...valid.pageMap[2], page: 4 }] } },
  { name: "section gap", value: { ...valid, sections: [valid.sections[0], { ...valid.sections[1], firstPage: 3 }] } },
  { name: "section overlap", value: { ...valid, sections: [{ ...valid.sections[0], lastPage: 2 }, valid.sections[1]] } },
  { name: "duplicate section IDs", value: { ...valid, sections: [valid.sections[0], { ...valid.sections[1], id: valid.sections[0].id }] } },
  { name: "uncovered initial page", value: { ...valid, sections: [valid.sections[1]] } },
  { name: "omitted terminal page", value: { ...valid, sections: [valid.sections[0], { ...valid.sections[1], lastPage: 2 }] } },
  { name: "section beyond final page", value: { ...valid, sections: [valid.sections[0], { ...valid.sections[1], lastPage: 4 }] } },
  { name: "reordered sections", value: { ...valid, sections: [valid.sections[1], valid.sections[0]] } },
]

for (const { name, value } of invalidIndexes) {
  test(`v2 rejects ${name}`, () => {
    assert.equal(DocumentIndexSchema.safeParse(value).success, false)
  })
}

test("legacy v1 indexes remain readable without v2 page maps or exhaustive coverage", () => {
  // Persisted OCR-era indexes start at detected headings and can omit covers and continuations.
  const legacy = {
    version: 1, digest, ocrPages: [2],
    sections: [
      { ...valid.sections[0], firstPage: 2, lastPage: 2 },
      { ...valid.sections[1], firstPage: 4, lastPage: 4 },
    ],
  }
  assert.deepEqual(DocumentIndexSchema.parse(legacy), legacy)
  assert.equal(DocumentIndexSchema.safeParse({ ...legacy, version: 2 }).success, false)
  assert.equal(DocumentIndexSchema.safeParse({ ...legacy, digest: "invalid" }).success, false)
})
