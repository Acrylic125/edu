import { expect, test } from "vitest"
import { materialDisplayName, materialReferenceLabel, resolveMaterialLink } from "../src/shared/material-links"

const id = "12345678-1234-4234-8234-123456789abc"

test("relative material links count file identities instead of repeated attachment entries", () => {
  const material = { id, name: "Lecture 8.pdf", kind: "pdf" as const }
  expect(resolveMaterialLink("assets/Lecture 8.pdf#page=4", [material, material])).toEqual({ id, page: 4 })
  expect(resolveMaterialLink("assets/Lecture 8.pdf#page=4", [material, { ...material, id: "22345678-1234-4234-8234-123456789abc" }])).toBeUndefined()
})

test.each([
  ["Lecture 6.pdf", "Lecture 6.pdf"],
  [`${id}-MIPS Basics.pptx`, "MIPS Basics.pptx"],
  [`${id}.pdf`, "Document.pdf"],
  [`${id}-pptx.pptx`, "Slides.pptx"],
  ["Lecture 4A - Pointers and Functions.pdf", "Lecture 4A - Pointers and Funct….pdf"],
])("uses a readable label for %s", (name, expected) => {
  expect(materialDisplayName({ id, name }, [{ id, name }])).toBe(expected)
})

test("numbering distinguishes shortened names without counting the same file twice", () => {
  const first = { id, name: `${id}-pdf.pdf` }
  const second = { id: "22345678-1234-4234-8234-123456789abc", name: "Document.pdf" }
  expect(materialDisplayName(first, [first, first, second])).toBe("Document 1.pdf")
  expect(materialDisplayName(second, [first, first, second])).toBe("Document 2.pdf")
})

test("preserves descriptive citation labels and compact lecture aliases", () => {
  const material = { id, name: "Lecture 6 - MIPS Part 1 (full set).pdf", kind: "pdf" as const }
  expect(materialReferenceLabel("Lecture 6.pdf, pg. 2-3", material, [material])).toBe("Lecture 6.pdf, pg. 2-3")
  expect(materialReferenceLabel("Register encoding", material, [material])).toBe("Register encoding")
})

test("a file keeps its number when chat and directory collect sources in different orders", () => {
  const first = { id, name: `${id}-pdf.pdf` }
  const second = { id: "22345678-1234-4234-8234-123456789abc", name: "Document.pdf" }
  expect(materialDisplayName(first, [first, second])).toBe("Document 1.pdf")
  expect(materialDisplayName(first, [second, first])).toBe("Document 1.pdf")
})

test("generated numbers do not reuse another file's readable name", () => {
  const materials = [
    { id, name: `${id}-pdf.pdf` },
    { id: "22345678-1234-4234-8234-123456789abc", name: "Document.pdf" },
    { id: "32345678-1234-4234-8234-123456789abc", name: "Document 1.pdf" },
  ]
  expect(materialDisplayName(materials[0], materials)).toBe("Document 2.pdf")
  expect(materialDisplayName(materials[1], materials)).toBe("Document 3.pdf")
  expect(materialDisplayName(materials[2], materials)).toBe("Document 1.pdf")
})
