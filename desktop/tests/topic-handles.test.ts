import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { WorkerJobSchema } from "../src/shared/contracts"
import { createTutorSession } from "../src/runners/tutor"

function fixture() {
  const tagged = newTopic("Calculus")
  const reference = newTopic("Algebra")
  reference.archived = true
  reference.learning.notes = "Reference algebra notes"
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({
    chat, topics: [{ ...tagged, assetDirectory: resolve("tests") }],
    workspaceTopics: [tagged, reference].map((topic) => ({ ...topic, notes: topic.learning.notes })),
    runner: { id: chat.runnerId, name: "Tutor", provider: "codex" },
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"),
  })
  return { job, tagged, reference }
}

test("topic handles allow cross-topic reads and scope writes while mutations retain UUIDs", async () => {
  const { job, tagged, reference } = fixture()
  const session = await createTutorSession(job, () => {})
  const read = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_2" })
  expect(read.success).toBe(true)
  expect(JSON.parse(read.text)).toMatchObject({ scratchpadId: "scratchpad_2", notes: reference.learning.notes })
  expect((await session.execute("topic_getTopicProgress", { topicId: "scratchpad_2" })).success).toBe(true)
  const denied = await session.execute("topic_editContent", { topicId: "scratchpad_2", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Unauthorized"] } }] })
  expect(denied.success).toBe(false)
  expect(denied.text).toContain("scratchpad_1")
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Calculus summary"] } }] })).success).toBe(true)
  await session.execute("save_learning_state", job.chat.learning)
  expect(session.finish("Updated Calculus").topicMutations).toMatchObject([{ type: "updateTopic", topicId: tagged.id }])
  expect(session.instructions).not.toContain(tagged.id)
  expect(session.instructions).not.toContain(reference.id)
})

test("invalid handles and raw UUIDs cannot publish until the same tool is corrected", async () => {
  const { job, tagged } = fixture()
  const session = await createTutorSession(job, () => {})
  for (const topicId of ["topic_99", tagged.id]) {
    const result = await session.execute("topic_updateTopic", { topicId, summary: "Rejected" })
    expect(result.success).toBe(false)
    expect(result.text).toContain("scratchpad_1")
  }
  await session.execute("save_learning_state", job.chat.learning)
  expect(session.saved).toBe(false)
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Corrected"] } }] })).success).toBe(true)
  expect(session.saved).toBe(true)
  expect(session.finish("Corrected").topicMutations).toHaveLength(1)
})

test("one thread can write multiple tagged topics while keeping references read-only", async () => {
  const { job, tagged, reference } = fixture()
  const second = newTopic("Geometry")
  job.topics.push({ ...second, assetDirectory: resolve("tests") })
  job.chat.topicHandles = [tagged.id, reference.id, second.id]
  const session = await createTutorSession(job, () => {})
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Calculus notes"] } }] })).success).toBe(true)
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_3", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Geometry notes"] } }] })).success).toBe(true)
  const notes = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_3" })
  expect(notes.success).toBe(true)
  expect(JSON.parse(notes.text)).toMatchObject({ scratchpadId: "scratchpad_3", title: "Geometry" })
  expect(notes.text).toContain("Geometry notes")
  const mistakes = await session.execute("topic_getMistakesForTopic", { topics: ["scratchpad_1", "scratchpad_2", "scratchpad_3"] })
  expect(mistakes.success).toBe(true)
  await session.execute("save_learning_state", job.chat.learning)
  expect(session.finish("Updated both topics").topicMutations).toMatchObject([
    { type: "updateTopic", topicId: tagged.id }, { type: "updateTopic", topicId: second.id },
  ])
  expect(JSON.parse((await session.execute("topic_getTopicProgress", { topicId: "scratchpad_2" })).text)).toEqual([])
})

test("topic links round-trip through model handles while literal UUID content stays intact", async () => {
  const { job, tagged } = fixture()
  const session = await createTutorSession(job, () => {})
  const stored = `[@Calculus](edu-topic://${tagged.id})`
  const visible = "[@Calculus](edu-topic://scratchpad_1)"
  expect(session.modelText(stored)).toBe(visible)
  expect(session.modelText(`Literal identifier: ${tagged.id}`)).toBe(`Literal identifier: ${tagged.id}`)
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: [`See ${visible}`] } }] })).success).toBe(true)
  await session.execute("save_learning_state", { ...job.chat.learning, notes: `See ${visible}` })
  expect(session.previewReply(visible)).toBe(stored)
  const result = session.finish(visible)
  expect(result.reply).toBe(stored)
  expect(result.learning.notes).toBe(`See ${stored}`)
  expect(result.topicMutations).toMatchObject([{ type: "updateTopic", summary: `See ${stored}` }])
})

test("new topics receive usable handles and handle meanings survive a resumed session", async () => {
  const { job, tagged, reference } = fixture()
  const session = await createTutorSession(job, () => {})
  const created = await session.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Geometry", content: [] } })
  expect(created.success).toBe(true)
  expect(JSON.parse(created.text)).toMatchObject({ scratchpadId: "scratchpad_3" })
  expect((await session.execute("topic_editContent", { topicId: "scratchpad_3", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Geometry notes"] } }] })).success).toBe(true)
  const notes = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_3" })
  expect(notes.success).toBe(true)
  expect(JSON.parse(notes.text)).toMatchObject({ scratchpadId: "scratchpad_3", title: "Geometry" })
  expect(notes.text).toContain("Geometry notes")
  await session.execute("save_learning_state", job.chat.learning)
  const mutation = session.finish("Created Geometry").topicMutations[0]
  expect(mutation.type).toBe("createTopic")
  const resumed = await createTutorSession({
    ...job,
    chat: { ...job.chat, topicHandles: [tagged.id, reference.id, mutation.topicId] },
    topics: [], workspaceTopics: [...job.workspaceTopics].reverse(),
  }, () => {})
  const read = await resumed.execute("read_scratchpad", { scratchpadId: "scratchpad_2" })
  expect(JSON.parse(read.text)).toMatchObject({ title: "Algebra" })
  expect((await resumed.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-limits", content: ["Read-only now"] } }] })).success).toBe(false)
})
