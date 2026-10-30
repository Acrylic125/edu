import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newScratchpad } from "../main/workspace"
import { applyTopicMutation } from "../main/state-service"
import { WorkerJobSchema } from "../shared/contracts"
import { applyTopicChanges, TopicMutationSchema, TopicStateSchema } from "../shared/topic-state"
import { createTutorSession } from "./tutor"

function fixture() {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("MIPS")
  scratchpad.planConfirmed = true
  const material = { id: randomUUID(), name: "lecture.pdf", kind: "pdf", text: "First page\nSecond page", pages: ["First page", "Second page"] }
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, content: [
    { id: "tp-first", name: "First", references: [{ type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 1, to: 1 }] }], goals: [], mistakes: [] },
    { id: "tp-second", name: "Second", references: [{ type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 2, to: 2 }] }], goals: [], mistakes: [{ context: "An answer", issue: "A gap" }] },
  ], document: { version: 1, blocks: [{ id: "first-notes", type: "markdown", sectionId: "tp-first", content: ["Saved explanation"] }] },
  threadTutors: [{ id: chat.id, currentPartId: "tp-first", progress: { "tp-first": { status: "active", steps: [{ question: "Explain", answerFromUser: "My answer" }] } } }] })
  chat.scratchpadHandles = [scratchpad.id]
  const job = WorkerJobSchema.parse({ runner, chat: { ...chat, materials: [material] }, scratchpads: [{ ...scratchpad, materials: [material], assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  return { job, state: TopicStateSchema.parse(scratchpad.state), materialId: material.id }
}

test("curriculum edits patch a section without dropping omitted fields, parts or history", () => {
  const { state } = fixture()
  const updated = applyTopicChanges(state, [{ action: "update", id: "tp-second", patch: { name: "Revised" } }])
  assert.deepEqual(updated.content[0], state.content[0])
  assert.deepEqual(updated.content[1], { ...state.content[1], name: "Revised" })
  assert.deepEqual(updated.threadTutors, state.threadTutors)
  assert.deepEqual(updated.document, state.document)
})

test("add, remove and move change scope while preserving removed evidence and a valid cursor", () => {
  const { state } = fixture()
  const updated = applyTopicChanges(state, [
    { action: "add", part: { id: "tp-new", name: "New", references: [], goals: [], mistakes: [] }, afterId: "tp-first" },
    { action: "remove", id: "tp-first" },
    { action: "move", id: "tp-second", afterId: null },
  ])
  assert.deepEqual(updated.content.map((part) => part.id), ["tp-second", "tp-new"])
  assert.deepEqual(updated.removedParts, [state.content[0]])
  assert.deepEqual(updated.threadTutors[0].progress, state.threadTutors[0].progress)
  assert.equal(updated.threadTutors[0].currentPartId, "tp-second")
  assert.deepEqual(updated.document, state.document)
})

test("invalid scope changes are atomic and cannot reuse removed IDs or leave dangling parents", () => {
  const { state } = fixture()
  const before = structuredClone(state)
  assert.throws(() => applyTopicChanges(state, [
    { action: "update", id: "tp-first", patch: { name: "Changed" } },
    { action: "move", id: "tp-second", afterId: "tp-missing" },
  ]), /target not found/)
  assert.deepEqual(state, before)
  assert.throws(() => applyTopicChanges(state, [{ action: "update", id: "tp-typo", patch: { name: "Changed" } }]), /not found/)
  assert.throws(() => applyTopicChanges(state, [
    { action: "remove", id: "tp-first" },
    { action: "add", part: state.content[0], afterId: null },
  ]), /already exists/)
  const parented = applyTopicChanges(state, [{ action: "update", id: "tp-second", patch: { parent: { id: "tp-first" } } }])
  assert.throws(() => applyTopicChanges(parented, [{ action: "remove", id: "tp-first" }]), /parents must exist/)
  assert.equal(applyTopicChanges(parented, [
    { action: "remove", id: "tp-first" },
    { action: "update", id: "tp-second", patch: { parent: null } },
  ]).content[0].parent, undefined)
})

test("state service rejects stale revisions and preserves the original state", () => {
  const { job } = fixture()
  const before = structuredClone(job.scratchpads[0].state)
  assert.throws(() => applyTopicMutation({ chats: [job.chat], scratchpads: job.scratchpads }, job.chat.id, TopicMutationSchema.parse({
    type: "updateTopic", scratchpadId: job.scratchpads[0].id, expectedRevision: 100,
    changes: [{ action: "remove", id: "tp-first" }],
  })), /changed during this turn/)
  assert.deepEqual(job.scratchpads[0].state, before)
})

test("a goal edit grounds only the affected section, and newly cited pages still require reads", async () => {
  const { job, state, materialId } = fixture()
  const session = await createTutorSession(job, () => {})
  const target = { scratchpadId: "scratchpad_1" }
  const goals = [{ objective: "Second objective", understoodWhen: ["Explain it"] }]
  assert.equal((await session.execute("read_material", { id: materialId, firstPage: 2, lastPage: 2 })).success, true)
  const updated = await session.execute("topic_updateTopic", { ...target, changes: [{ action: "update", id: "tp-second", patch: { goals } }] })
  assert.equal(updated.success, true, updated.text)
  const result = z.object({ state: TopicStateSchema }).parse(JSON.parse(updated.text))
  assert.equal(result.state.content.length, 2)
  const unread = await session.execute("topic_updateTopic", { ...target, changes: [{ action: "add", part: { ...state.content[0], id: "tp-new" }, afterId: "tp-second" }] })
  assert.equal(unread.success, false)
  assert.match(unread.text, /pages 1/)
  assert.equal((await session.execute("read_material", { id: materialId, firstPage: 1, lastPage: 1 })).success, true)
  const add = { ...target, changes: [{ action: "add", part: { ...state.content[0], id: "tp-new" }, afterId: "tp-second" }] }
  assert.equal((await session.execute("topic_updateTopic", add)).success, true)
  const retried = await session.execute("topic_updateTopic", add)
  assert.equal(retried.success, true, retried.text)
  const read = await session.execute("read_scratchpad", target)
  const current = z.object({ state: TopicStateSchema }).parse(JSON.parse(read.text))
  assert.equal(current.state.content.filter((part) => part.id === "tp-new").length, 1)
  assert.equal((await session.execute("topic_updateTopic", { ...target, content: [] })).success, false)
})
