import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { newChat } from "../main/workspace"
import { indexDocument, materialDigest } from "../main/material-extraction"
import { WorkerJobSchema } from "../shared/contracts"
import { RoleJobSchema } from "../shared/tutor-workflow"
import { createTutorSession } from "./tutor"
import { createTopicPlannerSession } from "./topic-planner"
import { createWorkflowRoleSession } from "./workflow-session"
import { createVisionFixture, presentationFixture } from "../../test/document-fixtures"

for (const provider of ["codex", "claude"] as const) {
  test(`${provider} without an available visual adapter retains unresolved PDF pages and blocks an unreviewed plan`, async (t) => {
    // A native heading on page 2 must not hide an unresolved page 1 or authorize text-only visual claims.
    const directory = await mkdtemp(join(tmpdir(), "edu-planner-pages-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const runner = { id: randomUUID(), name: "Tutor", provider, model: "test" }
    const chat = newChat(runner.id)
    const bytes = Buffer.from("Native source fixture")
    const pages = ["Cover and introductory content. ".repeat(5), "1. Introduction\n" + "Course concepts. ".repeat(10)]
    const material = { id: randomUUID(), name: "lecture.pdf", kind: "pdf" as const, text: pages.join("\n"), pages,
      documentIndex: indexDocument(materialDigest(bytes, ".pdf"), pages, "Lecture") }
    chat.materials.push(material)
    await writeFile(join(directory, material.name), bytes)
    const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory,
      ...(provider === "claude" ? { codex: { executable: "/must-not-start-codex", home: directory } } : {}) })
    const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
      request: { target: { mode: "create", type: "topic" }, task: "Plan the full lecture", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [material.id], readDependencies: [], relevantContext: "" } } })
    const context = await createTopicPlannerSession(job, role, undefined, () => {})
    const { session } = context
    assert.match(session.instructions, /"unresolvedPages":\[1\]/)
    const inspected = await session.execute("inspect_source_pages", { materialId: material.id, firstPage: 1, lastPage: 1, includeVisuals: false })
    assert.equal(inspected.success, true, inspected.text)
    assert.match(inspected.text, /Cover and introductory content/)
    assert.equal((await session.execute("inspect_source_pages", { materialId: randomUUID(), firstPage: 1, lastPage: 1 })).success, false)
    const section = material.documentIndex.sections[0]
    assert.equal((await session.execute("select_topic_sections", { sectionIds: [section.id] })).success, true)
    const plan = await session.execute("submit_topic_plan", { title: "Lecture", sections: [{ sectionId: section.id, goals: [] }] })
    assert.equal(plan.success, false)
    assert.match(plan.text, /requires screenshot review/)
    assert.equal(session.saved, false)
    assert.equal((await session.execute("request_topic_clarification", { question: "Can you select a vision-capable runner for the cover page?" })).success, true)
    assert.equal(context.output?.needsClarification, true)
  })
}


test("a Codex planner resolves PDF screenshots before exposing the index and staging its plan", { timeout: 15_000 }, async (t) => {
  // The model boundary returns a heading absent from native text; only a completed visual pass supplies it.
  const source = await createVisionFixture(1)
  t.after(() => rm(source.directory, { recursive: true, force: true }))
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.materials.push(source.material)
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: source.directory, sourceCacheDirectory: source.cache, codex: source.connection })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
    request: { target: { mode: "create", type: "topic" }, task: "Plan the full lecture", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [source.material.id], readDependencies: [], relevantContext: "" } } })
  const context = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  assert.match(context.session.instructions, /Heading 1/)
  assert.match(context.session.instructions, /"unresolvedPages":\[\]/)
  const inspection = await context.session.execute("inspect_source_pages", { materialId: source.material.id, firstPage: 1, lastPage: 1, includeVisuals: true })
  assert.equal(inspection.success, true, inspection.text)
  assert.ok(inspection.images.some((part) => part.type === "image_url"))
  const section = source.material.documentIndex.sections[0]
  assert.equal((await context.session.execute("select_topic_sections", { sectionIds: [section.id] })).success, true)
  const result = await context.session.execute("submit_topic_plan", { title: "Visually indexed lecture", sections: [{ sectionId: section.id, goals: [] }] })
  assert.equal(result.success, true, result.text)
  assert.deepEqual(context.output?.evidence, [{ type: "pdf", path: "assets/pages.pdf", pages: [{ from: 1, to: 1 }] }])
})

for (const extension of [".pdf", ".pptx"]) {
  test(`legacy ${extension} attachments without an index use structured extraction instead of cached plain text`, async (t) => {
    // Old attachments can have plenty of text yet no layout index; text length must not bypass extraction.
    const source = await createVisionFixture(1)
    t.after(() => rm(source.directory, { recursive: true, force: true }))
    let bytes = await readFile(join(source.directory, source.material.name))
    if (extension === ".pptx") bytes = await presentationFixture()
    const name = `legacy${extension}`
    await writeFile(join(source.directory, name), bytes)
    const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
    const chat = newChat(runner.id)
    const stale = "9.9 STALE_TEXT_INDEX\n" + "Previously extracted text. ".repeat(10)
    chat.materials.push({ id: randomUUID(), name, kind: extension === ".pdf" ? "pdf" : "text", text: stale, pages: [stale] })
    const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: source.directory })
    const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
      request: { target: { mode: "create", type: "topic" }, task: "Plan the attached lecture", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [chat.materials[0].id], readDependencies: [], relevantContext: "" } } })
    const context = await createTopicPlannerSession(job, role, undefined, () => {})
    const updated = context.job.chat.materials[0]
    assert.equal(updated.documentIndex?.version, 2)
    assert.equal(updated.documentIndex.pageCount, 1)
    assert.ok(updated.documentIndex.pageMap?.[0].blocks.some((block) => block.bounds))
    assert.doesNotMatch(updated.text, /STALE_TEXT_INDEX/)
    assert.doesNotMatch(context.session.instructions, /STALE_TEXT_INDEX/)
    if (extension === ".pptx") assert.match(context.session.instructions, /Native slide title/)
  })
}

test("standalone PPTX plans from native structure without starting a converter or vision runner", async (t) => {
  const source = await createVisionFixture(1)
  t.after(() => rm(source.directory, { recursive: true, force: true }))
  const bytes = await presentationFixture()
  const material = { ...source.material, name: "lecture.pptx", kind: "text" as const, pages: ["Slide content without a title"], text: "Slide content without a title",
    documentIndex: indexDocument(materialDigest(bytes, ".pptx"), ["Slide content without a title"], "Lecture") }
  await writeFile(join(source.directory, material.name), bytes)
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.materials.push(material)
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: source.directory,
    codex: { executable: "/must-not-start-vision-for-pptx", home: source.directory } })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
    request: { target: { mode: "create", type: "topic" }, task: "Plan the lecture", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [material.id], readDependencies: [], relevantContext: "" } } })
  const context = await createTopicPlannerSession(job, role, undefined, () => {})
  const section = material.documentIndex.sections[0]
  const read = await context.session.execute("select_topic_sections", { sectionIds: [section.id], includeVisuals: true })
  assert.equal(read.success, true, read.text)
  assert.equal(read.images.length, 0)
  assert.match(read.text, /native|layout/i)
  const plan = await context.session.execute("submit_topic_plan", { title: "Lecture", sections: [{ sectionIds: [section.id], goals: [] }] })
  assert.equal(plan.success, true, plan.text)
  assert.deepEqual(context.output?.evidence, [{ type: "ppt", path: "assets/lecture.pptx", pages: [{ from: 1, to: 1 }] }])
})

test("a learning part combines reviewed continuation sections into one source range", async (t) => {
  const source = await createVisionFixture(3)
  t.after(() => rm(source.directory, { recursive: true, force: true }))
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.materials.push(source.material)
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: source.directory, sourceCacheDirectory: source.cache, codex: source.connection })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
    request: { target: { mode: "create", type: "topic" }, task: "Group the walkthrough into one part", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [source.material.id], readDependencies: [], relevantContext: "" } } })
  const context = await createTopicPlannerSession(job, role, undefined, () => {})
  const sectionIds = context.job.chat.materials[0].documentIndex!.sections.map((section) => section.id)
  assert.equal(sectionIds.length, 3)
  assert.equal((await context.session.execute("select_topic_sections", { sectionIds })).success, true)
  const duplicate = await context.session.execute("submit_topic_plan", { title: "Lecture", sections: [{ sectionIds: [sectionIds[0], sectionIds[0]], goals: [] }] })
  assert.equal(duplicate.success, false)
  const result = await context.session.execute("submit_topic_plan", { title: "Lecture", sections: [{ sectionIds, name: "Walkthrough", goals: [] }] })
  assert.equal(result.success, true, result.text)
  assert.deepEqual(context.output?.evidence, [{ type: "pdf", path: "assets/pages.pdf", pages: [{ from: 1, to: 3 }] }])
})

test("a matching attached PDF supplies visuals and a single canonical curriculum for a PPTX", async (t) => {
  const source = await createVisionFixture(1)
  t.after(() => rm(source.directory, { recursive: true, force: true }))
  const bytes = await presentationFixture()
  const pages = source.material.pages
  const presentation = { ...source.material, id: randomUUID(), name: "pages.pptx", kind: "text" as const,
    documentIndex: indexDocument(materialDigest(bytes, ".pptx"), pages, "Slides") }
  await writeFile(join(source.directory, presentation.name), bytes)
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.materials.push(presentation, source.material)
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: source.directory, sourceCacheDirectory: source.cache, codex: source.connection })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [],
    request: { target: { mode: "create", type: "topic" }, task: "Plan the lecture once", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [presentation.id, source.material.id], readDependencies: [], relevantContext: "" } } })
  const context = await createTopicPlannerSession(job, role, undefined, () => {})
  const inventory = context.session.instructions.split("Source page inventory: ")[1].split("\n")[0]
  assert.match(inventory, /pages.pdf/)
  assert.doesNotMatch(inventory, /pages.pptx/)
  const tutor = await createTutorSession(context.job, () => {})
  const read = await tutor.execute("read_material", { id: presentation.id, firstPage: 1, lastPage: 1, includeVisuals: true })
  assert.equal(read.success, true, read.text)
  assert.match(read.text, new RegExp(`edu-source://${source.material.id}/1`))
  assert.doesNotMatch(read.text, new RegExp(`edu-source://${presentation.id}/1`))
  assert.ok(read.images.some((part) => part.type === "image_url"))
})
