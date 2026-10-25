import assert from "node:assert/strict"
import { z } from "zod"
import { DocumentSectionSchema } from "../shared/document-index"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { newChat, newTopic } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { createWorkflowRoleSession, createWorkflowTutorSession } from "./workflow-session"
import { RoleJobSchema } from "../shared/tutor-workflow"
import { TopicStateSchema } from "../shared/topic-state"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"

test("Tutor receives a directory and teaching tools without scratchpad state or management access", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Continue", createdAt: new Date().toISOString(), topicIds: [] })
  const scratchpad = newTopic("Fractions", "generic")
  scratchpad.learning.notes += "A private scratchpad payload."
  chat.topicHandles.push(scratchpad.id)
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...scratchpad, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const { session } = await createWorkflowTutorSession(job, [], "", () => {})
  assert.equal(session.instructions.includes("A private scratchpad payload."), false)
  assert.equal(session.instructions.includes("MANAGE_GENERIC"), false)
  assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role"), true)
  assert.equal((await session.execute("read_scratchpad", { scratchpadId: "scratchpad_1" })).success, false)
  assert.equal((await session.execute("read_skill", { path: "skills/MANAGE_GENERIC.md" })).success, false)
  assert.equal((await session.execute("generic_updateScratchpad", { genericId: "scratchpad_1", summary: "Overwrite" })).success, false)
})

test("an existing open topic can save a teaching handoff after its creation turn", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.scratchpadRequested = true
  chat.messages.push({ id: randomUUID(), role: "user", content: "Continue with the first section", createdAt: new Date().toISOString(), topicIds: [] })
  const topic = newTopic("Vector Spaces")
  chat.topicHandles.push(topic.id)
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], openedTopicId: topic.id, skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const { session } = await createWorkflowTutorSession(job, [], "", () => {})

  const result = await session.execute("save_learning_state", {
    ...chat.learning,
    phase: "ready_to_continue",
    nextAction: "Wait for the learner's answer",
    workpad: "Explained the first section and asked one check.",
  })

  assert.equal(result.success, true, result.text)
})

test("a read-only generic role cannot write or read another scratchpad's state or skills", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const target = newTopic("Fractions", "generic")
  const other = newTopic("Assessment", "test")
  other.learning.notes = "Private assessment notes"
  chat.learning.privateAnswerKey = "Private answer key"
  chat.topicHandles = [target.id, other.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [target, other].map((topic) => ({ ...topic, assetDirectory: "/tmp" })), skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "generic", access: "read", mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Read the notes", requestedAccess: "read", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } },
  })
  const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  assert.equal(session.instructions.includes("Private assessment notes"), false)
  assert.equal(session.instructions.includes("Private answer key"), false)
  assert.equal((await session.execute("generic_updateScratchpad", { genericId: "scratchpad_1", summary: "Overwrite" })).success, false)
  assert.equal((await session.execute("read_scratchpad", { scratchpadId: "scratchpad_2" })).success, false)
  assert.equal((await session.execute("read_skill", { path: "skills/MANAGE_TEST.md" })).success, false)
  assert.equal((await session.execute("read_scratchpad", { scratchpadId: "scratchpad_1" })).success, true)
  const finished = await session.execute("finish_role", { summary: "Read fraction notes", evidence: [{ type: "topic", id: "scratchpad_1" }] })
  assert.equal(finished.success, true, finished.text)
})

test("roles can read recorded questions with ungranted source blocks while material reads remain restricted", async () => {
  for (const access of ["read", "write"] as const) {
    const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
    const chat = newChat(runner.id)
    const target = newTopic("Vector spaces")
    const material = { id: randomUUID(), name: "Vector Spaces.pdf", kind: "pdf" as const, text: "Ungrantable source text", pages: ["Ungrantable source text"] }
    const granted = { id: randomUUID(), name: "exercise.txt", kind: "text" as const, text: "Granted exercise text", pages: ["Granted exercise text"] }
    const question = "Which vector-space axiom fails?"
    target.planConfirmed = true
    target.materials = [material, granted]
    target.state = TopicStateSchema.parse({
      type: "topic", version: "11-10-2026", name: target.title, createdAt: target.createdAt,
      content: [{ id: "tp-axioms", name: "Axioms", references: [{ type: "pdf", path: "assets/Vector Spaces.pdf", pages: [{ from: 1, to: 1 }] }], goals: [], mistakes: [] }],
      document: { version: 1, blocks: [{ type: "source", id: "source-1", sectionId: "tp-axioms", materialId: material.id, page: 1, presentation: "link" }] },
      threadTutors: [{ id: chat.id, progress: { "tp-axioms": { status: "active", steps: [{ question }] } } }],
    })
    chat.topicHandles = [target.id]
    const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...target, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
    for (const materialIds of [[], [granted.id]]) {
      const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "topic", access, mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
        request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Return the exact recorded question", requestedAccess: access, context: { learnerMessageIds: [], materialIds, readDependencies: [], relevantContext: "" } },
      })
      const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
      const questions = await session.execute("topic_getQuestions", { topicId: "scratchpad_1", topicPartId: "tp-axioms" })
      assert.equal(questions.success, true, questions.text)
      assert.ok(questions.text.includes(question))
      const scratchpad = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_1" })
      assert.equal(scratchpad.success, true, scratchpad.text)
      assert.ok(scratchpad.text.includes(`edu-material://${material.id}/1`))
      assert.equal(scratchpad.text.includes(material.text), false)
      assert.equal(session.instructions.includes(material.text), false)
      assert.equal(session.instructions.includes(`"referencePath":"assets/${material.name}"`), false)
      const denied = await session.execute("read_material", { id: material.id, firstPage: 1, lastPage: 1 })
      assert.equal(denied.success, false)
      assert.match(denied.text, /not granted/)
      const exercise = await session.execute("read_material", { id: granted.id, firstPage: 1, lastPage: 1 })
      assert.equal(exercise.success, materialIds.includes(granted.id), exercise.text)
      const finished = await session.execute("finish_role", { summary: question, evidence: [{ type: "topic", id: "scratchpad_1" }] })
      assert.equal(finished.success, true, finished.text)
    }
  }
})

test("role writer tools persist a stage before reporting success and reuse the allocated creation identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-role-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const material = { id: randomUUID(), name: "fractions.txt", kind: "text" as const, text: "One half is two quarters.", pages: ["One half is two quarters."] }
  chat.materials.push(material)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Create some notes", createdAt: new Date().toISOString(), topicIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, topics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ target: { mode: "create", type: "generic" }, task: "Create notes", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [material.id], readDependencies: [], relevantContext: "" } }])
  const role = batch.jobs[0]
  const { session } = await createWorkflowRoleSession(job, role, (mutation) => workflows.stage(turn.chatId, turn.turnId, role.jobId, "create", mutation), () => {}, (id, first, last) => workflows.recordRead(turn.chatId, turn.turnId, role.jobId, id, first, last))
  const read = await session.execute("read_material", { id: material.id, firstPage: 1, lastPage: 1 })
  assert.equal(read.success, true, read.text)
  const result = await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] } })
  assert.equal(result.success, true, result.text)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const saved = new TutorWorkflowRepository(reopened).get(turn.chatId, turn.turnId).batches[0].jobs[0]
  assert.equal(saved.operations[0]?.mutation.topicId, role.scratchpadId)
  assert.deepEqual(saved.readEvidence, [{ materialId: material.id, page: 1 }])
  assert.equal(reopened.stateSnapshot.topics.length, 0)
  const resumed = await createWorkflowRoleSession(job, saved, (mutation) => workflows.stage(turn.chatId, turn.turnId, role.jobId, "create", mutation), () => {})
  assert.equal(resumed.session.instructions.includes('"reviewedPages":[1]'), true, "Recovery must identify pages already verified by the host")
  assert.match(resumed.session.instructions, /already applied/)
  const replay = await resumed.session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] } })
  assert.equal(replay.success, true, replay.text)
  assert.equal(workflows.get(turn.chatId, turn.turnId).batches[0].jobs[0].operations.length, 1)
})

test("a role reads a granted scratchpad image from that scratchpad's asset directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-role-source-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const assetDirectory = join(directory, "scratchpad-assets")
  await mkdir(assetDirectory)
  await writeFile(join(assetDirectory, "diagram.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=", "base64"))
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const target = newTopic("Fractions", "generic")
  const image = { id: randomUUID(), name: "diagram.png", kind: "image" as const, text: "Fraction diagram", pages: ["Fraction diagram"] }
  target.materials.push(image)
  chat.topicHandles = [target.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [], workspaceTopics: [{ ...target, notes: target.learning.notes, assetDirectory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: join(directory, "chat-assets") })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "generic", access: "read", mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Inspect the diagram", requestedAccess: "read", context: { learnerMessageIds: [], materialIds: [image.id], readDependencies: [], relevantContext: "" } },
  })
  const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  const result = await session.execute("read_material", { id: image.id, firstPage: 1, lastPage: 1 })
  assert.equal(result.success, true, result.text)
  assert.equal(result.images.length, 2)
})

test("a draft topic role returns its staged plan after refusing premature teaching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html><title>Fractions</title><body>" + "Halves and quarters explain equal parts of a whole. ".repeat(4) + "</body></html>"))
  const directory = await mkdtemp(join(tmpdir(), "edu-draft-role-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Propose a fractions plan", createdAt: new Date().toISOString(), topicIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, topics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ target: { mode: "create", type: "topic" }, task: "Save the proposed plan and wait for confirmation", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } }])
  const role = batch.jobs[0]
  const { session } = await createWorkflowRoleSession(job, role, (mutation) => workflows.stage(turn.chatId, turn.turnId, role.jobId, "create", mutation), () => {})
  const source = await session.execute("inspect_web_source", { url: "https://example.com/fractions" })
  const inspected = z.object({ section: DocumentSectionSchema }).parse(JSON.parse(source.text))
  const created = await session.execute("submit_topic_plan", { title: "Fractions", sections: [{ sectionId: inspected.section.id, goals: [] }] })
  assert.equal(created.success, true, created.text)
  const edit = await session.execute("topic_editContent", { topicId: role.scratchpadHandle, changes: [{ action: "add", block: { type: "markdown", id: "lesson", sectionId: "tp-halves", content: ["Start teaching halves"] } }] })
  assert.equal(edit.success, false)
  const finished = await session.execute("finish_role", { summary: "Proposed the fractions plan. Awaiting learner confirmation.", evidence: [] })
  assert.equal(finished.success, false, "Completed planning no longer accepts an extra finish_role call")
  assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "topic_editContent"), false)
  await workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: session.finish().reply, evidence: [] })
  await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  const saved = workspace.topic(role.scratchpadId)
  assert.equal(saved.planConfirmed, false)
  assert.deepEqual(saved.state?.type === "topic" && saved.state.document?.blocks, [])
})

test("planning section IDs produce canonical asset references owned by the host", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-indexed-reference-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const material = { id: randomUUID(), name: "vector-spaces-copy.pdf", kind: "pdf" as const, text: "Vector spaces and their axioms. ".repeat(4), pages: ["6.1 Vector spaces\n" + "Vector spaces and their axioms. ".repeat(4)] }
  chat.materials.push(material)
  await writeFile(join(directory, material.name), "Embedded text fixture")
  const job = WorkerJobSchema.parse({ runner, chat, topics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", snapshot: null, baseVersion: null, operations: [], request: { target: { mode: "create", type: "topic" }, task: "Plan vector spaces", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [material.id], readDependencies: [], relevantContext: "" } } })
  const context = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  const line = context.session.instructions.split("\n").find((line) => line.startsWith("Indexed curriculum sections: "))!
  const [section] = z.array(DocumentSectionSchema).parse(JSON.parse(line.slice("Indexed curriculum sections: ".length)))
  assert.equal((await context.session.execute("select_topic_sections", { sectionIds: [section.id] })).success, true)
  assert.equal((await context.session.execute("submit_topic_plan", { title: "Vector spaces", sections: [{ sectionId: section.id, goals: [] }] })).success, true)
  assert.deepEqual(context.output?.evidence, [{ type: "pdf", path: "assets/vector-spaces-copy.pdf", pages: [{ from: 1, to: 1 }] }])
})

test("confirmed topics retain lesson editing while existing drafts return to Tutor for confirmation", async () => {
  for (const planConfirmed of [false, true]) {
    const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
    const chat = newChat(runner.id)
    const target = newTopic("Fractions")
    target.planConfirmed = planConfirmed
    chat.topicHandles = [target.id]
    const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...target, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
    const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
      request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Continue fractions", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } },
    })
    const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
    if (planConfirmed) {
      assert.match(session.instructions, /Read the specific source pages needed for the current explanation or question/)
      assert.match(session.instructions, /reviewedPages.*read only the missing pages/)
    } else {
      assert.match(session.instructions, /submit_topic_plan/)
      assert.doesNotMatch(session.instructions, /Before activating a part/)
    }
    const result = await session.execute("topic_editContent", { topicId: role.scratchpadHandle, changes: [{ action: "add", block: { type: "markdown", id: "halves", content: ["One half is two quarters."] } }] })
    assert.equal(result.success, planConfirmed, result.text)
    let finished
    if (planConfirmed) finished = await session.execute("finish_role", { summary: "Returned current learning position to Tutor", evidence: [] })
    else finished = await session.execute("request_topic_clarification", { question: "What should change in the proposed plan?" })
    assert.equal(finished.success, true, finished.text)
  }
})
