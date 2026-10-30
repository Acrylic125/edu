import assert from "node:assert/strict"
import { readFile, mkdir, writeFile, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { extractMaterial } from "../desktop/src/main/material-extraction"
import { reviewDocumentWithCodex } from "../desktop/src/runners/document-vision"
import { DocumentIndexSchema } from "../desktop/src/shared/document-index"

const { values } = parseArgs({ options: {
  "structure-only": { type: "boolean", default: false },
  fresh: { type: "boolean", default: false },
  model: { type: "string", default: "gpt-6-luna" },
  "codex-home": { type: "string", default: join(homedir(), "Library/Application Support/EdU/workspace/providers/codex") },
  "codex-executable": { type: "string", default: "codex" },
} })
const fixtures = [
  "From_Code_Generation_to_Software_Testing_AI_Copilot_With_Context-Based_Retrieval-Augmented_Generation.pdf",
  "Vector Spaces.pdf",
  "2026_CS2107_Topic_2.pdf",
]
const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts")
const cache = join(artifacts, "cache")

async function main() {
  await mkdir(artifacts, { recursive: true })
  if (values.fresh) await rm(cache, { recursive: true, force: true })
  const reports = []
  for (const [offset, name] of fixtures.entries()) {
    const bytes = await readFile(join(artifacts, name))
    const started = performance.now()
    const extracted = await extractMaterial(bytes, ".pdf", cache)
    const extractionMs = performance.now() - started
    assert.equal(extracted.pages.length, [9, 70, 34][offset], `${name}: physical page count`)
    assert.ok(extracted.documentIndex)
    const provisional = extracted.documentIndex
    let index = provisional
    let visualMs = 0
    let batches: Awaited<ReturnType<typeof reviewDocumentWithCodex>>["batches"] = []
    let visualCached = false
    if (!values["structure-only"]) {
      const visualStarted = performance.now()
      const reviewed = await reviewDocumentWithCodex({ ...extracted, id: `fixture-${offset + 1}`, name }, artifacts,
        { executable: values["codex-executable"], home: values["codex-home"] }, values.model, cache,
        (message) => console.log(`${name}: ${message}`))
      index = reviewed.index
      visualMs = performance.now() - visualStarted
      batches = reviewed.batches
      visualCached = reviewed.cached
    }
    DocumentIndexSchema.parse(index)
    const covered = index.sections.flatMap((section) => Array.from({ length: section.lastPage - section.firstPage + 1 }, (_, index) => section.firstPage + index))
    assert.deepEqual(covered, extracted.pages.map((_, index) => index + 1), `${name}: every page must be indexed exactly once`)
    assert.equal(index.pageMap?.length, extracted.pages.length)
    assert.ok(index.pageMap?.some((page) => page.width && page.height), `${name}: preserve page geometry`)
    assert.ok(index.pageMap?.some((page) => page.blocks.some((block) => block.bounds)), `${name}: preserve layout bounds`)
    if (!values["structure-only"]) {
      const expected = [
        [{ page: 2, title: /Related Work/ }, { page: 3, title: /Methodology/ }, { page: 6, title: /Evaluation/ }],
        [{ page: 5, title: /6\.1.*Vector spaces/i }, { page: 12, title: /6\.2.*Subspaces/i }, { page: 68, title: /6\.15.*Change of basis/i }],
        [{ page: 1, title: /Public Key Cryptography/ }, { page: 14, title: /RSA/ }, { page: 34, title: /Post.quantum cryptography/i }],
      ][offset]
      for (const heading of expected) assert.match(index.pageMap?.[heading.page - 1].headings.map((entry) => entry.text).join(" / ") ?? "", heading.title, `${name}: source heading on page ${heading.page}`)
    }
    if (!values["structure-only"]) assert.equal(index.pageMap?.filter((page) => page.needsVisualReview).length, 0, "Full indexing must finish visual review")
    const cachedStarted = performance.now()
    assert.deepEqual(await extractMaterial(bytes, ".pdf", cache), extracted)
    const cacheReadMs = performance.now() - cachedStarted
    const report = { file: name, mode: values["structure-only"] ? "structure-only" : "structure-and-vision", model: values.model,
      pageCount: extracted.pages.length, structuralHeadings: provisional.pageMap?.reduce((sum, page) => sum + page.headings.length, 0),
      visualPages: provisional.pageMap?.filter((page) => page.needsVisualReview).length,
      unresolvedPages: index.pageMap?.filter((page) => page.needsVisualReview).map((page) => page.page),
      extractionMs, visualMs, cacheReadMs, visualCached, batches,
      inputTokens: batches.reduce((sum, batch) => sum + (batch.inputTokens ?? 0), 0),
      outputTokens: batches.reduce((sum, batch) => sum + (batch.outputTokens ?? 0), 0), index }
    reports.push(report)
    await writeFile(join(artifacts, `${name}.index.json`), JSON.stringify(report, null, 2))
    const lines = [`# ${name}`, "", `Pages: ${report.pageCount}. Mode: ${report.mode}.`,
      `Extraction: ${(extractionMs / 1000).toFixed(3)}s. Visual review: ${(visualMs / 1000).toFixed(3)}s. Cached extraction: ${cacheReadMs.toFixed(1)}ms.`,
      `Visual pages: ${report.visualPages}. Unresolved: ${report.unresolvedPages?.length ?? 0}.`,
      `Reported tokens for this run: ${report.inputTokens} input, ${report.outputTokens} output. Cache hits make no new model calls.`, "", "## Section index", "",
      ...index.sections.map((section) => `- **${section.firstPage}–${section.lastPage}**: ${section.title}`), "", "## Page heading provenance", "",
      ...(index.pageMap ?? []).map((page) => `- Page ${page.page} [${page.headingSource}${page.needsVisualReview ? "; needs screenshot review" : ""}]: ${page.headings.map((heading) => heading.text).join(" / ") || "No heading (continuation or unclassified)"}`)]
    await writeFile(join(artifacts, `${name}.index.md`), lines.join("\n") + "\n")
    console.log(JSON.stringify({ ...report, index: undefined, batches: undefined }))
  }
  await writeFile(join(artifacts, "index-report.json"), JSON.stringify(reports, null, 2))
  await writeFile(join(artifacts, "indexes.md"), (await Promise.all(fixtures.map((name) => readFile(join(artifacts, `${name}.index.md`), "utf8")))).join("\n\n---\n\n"))
}

main().catch((error: Error) => { console.error(error); process.exitCode = 1 })
