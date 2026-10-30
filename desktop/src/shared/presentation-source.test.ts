import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { matchingPresentationPdf } from "./presentation-source"

test("presentation PDF pairing requires an unambiguous filename, page count and matching page content", () => {
  const presentation = { id: randomUUID(), name: "Lecture.pptx", kind: "text" as const, pages: ["Instruction set architecture", "Machine code"], text: "" }
  const pdf = { ...presentation, id: randomUUID(), name: "Lecture.pdf", kind: "pdf" as const }
  assert.equal(matchingPresentationPdf(presentation, [pdf]), pdf)
  assert.equal(matchingPresentationPdf(presentation, [{ ...pdf, pages: ["Machine code", "Instruction set architecture"] }]), undefined)
  assert.equal(matchingPresentationPdf(presentation, [{ ...pdf, pages: ["Instruction set architecture"] }]), undefined)
  assert.equal(matchingPresentationPdf(presentation, [{ ...pdf, name: "Other.pdf" }]), undefined)
  assert.equal(matchingPresentationPdf(presentation, [pdf, { ...pdf, id: randomUUID() }]), undefined)
  assert.equal(matchingPresentationPdf({ ...presentation, pages: ["", ""] }, [pdf]), undefined)
})
