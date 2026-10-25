import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { newChat, newTopic, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorSession } from "./tutor"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"

test("an ordinary teaching response generates and publishes its lesson in one model invocation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-single-turn-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  const unrelatedDraft = newTopic("Unrelated draft")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{ id: "tp-halves", name: "Halves", references: [{ type: "website", url: "https://example.com/fractions" }], goals: [], mistakes: [] }] })
  chat.topicHandles = [topic.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain halves", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  await workspace.mutate((state) => { state.chats.push(chat); state.topics.push(topic, unrelatedDraft) })
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: directory }, { ...unrelatedDraft, assetDirectory: directory }], openedTopicId: topic.id, skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  let invocations = 0
  await createTutorGraph(workflows, async (input, session) => {
    invocations += 1
    assert.ok(session.tools.some((tool) => tool.type === "function" && tool.function.name === "topic_editContent"), "Teaching tools must be available in the first invocation; a separate role invocation causes the regression")
    const edit = await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "halves", sectionId: "tp-halves", content: ["Two equal halves make one whole."] } }], present: ["halves"] })
    assert.equal(edit.success, true, edit.text)
    assert.equal(workflows.get(chat.id, turn.turnId).batches[0].jobs[0].operations.length, 1, "Writes are durable before the tool succeeds")
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", workpad: "Explained halves", nextAction: "Wait for the learner" })
    assert.equal(saved.success, true, saved.text)
    return { ...session.finish(""), providerSession: { provider: "codex", threadId: "single-session", home: directory, executable: "/codex", toolVersion: 24, status: "ready" } }
  }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(invocations, 1)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Two equal halves make one whole.")
  assert.equal(workspace.chat(chat.id).providerSession?.threadId, "single-session", "The next turn can resume the conversation")
  assert.equal(TopicStateSchema.parse(workspace.topic(topic.id).state).document?.blocks.length, 1)
})

test("recording an answer and teaching one page do not require rereading the entire curriculum range", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  const material = { id: randomUUID(), name: "fractions.pdf", kind: "pdf" as const, text: "Fractions", pages: Array.from({ length: 7 }, (_, index) => `Page ${index + 1}: fractions`) }
  topic.planConfirmed = true
  topic.materials = [material]
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{ id: "tp-halves", name: "Halves", references: [{ type: "pdf", path: "assets/fractions.pdf", pages: [{ from: 1, to: 7 }] }], goals: [], mistakes: [] }], threadTutors: [{ id: chat.id, progress: { "tp-halves": { status: "active", steps: [{ question: "How many halves make one whole?" }] } } }] })
  chat.topicHandles = [topic.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const session = await createTutorSession(job, () => {})
  const answer = await session.execute("topic_recordAnswer", { topicId: "scratchpad_1", topicPartId: "tp-halves", stepIndex: 0, answerFromUser: "Two" })
  assert.equal(answer.success, true, answer.text)
  assert.equal((await session.execute("read_material", { id: material.id, firstPage: 1, lastPage: 1 })).success, true)
  const edit = await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "halves", sectionId: "tp-halves", content: ["Two halves make one whole."] } }, { action: "add", block: { type: "source", id: "page-one", sectionId: "tp-halves", materialId: material.id, page: 1 } }] })
  assert.equal(edit.success, true, edit.text)
  const unread = await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "source", id: "unread", materialId: material.id, page: 7 } }] })
  assert.equal(unread.success, false)
  assert.match(unread.text, /Read content source/)
})


test("learner-facing response previews arrive before saving the private handoff", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const job = WorkerJobSchema.parse({ runner, chat, topics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const session = await createTutorSession(job, () => {})
  assert.equal(session.saved, false)
  assert.equal(session.previewReply("Two equal halves"), "Two equal halves")
  assert.throws(() => session.finish("Two equal halves"), /complete learning state/)
})

test("scratchpad visuals stay separate from chat and Retry does not duplicate saved steps", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-streamed-lesson-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{ id: "tp-halves", name: "Halves", references: [], goals: [], mistakes: [] }], threadTutors: [{ id: chat.id, progress: { "tp-halves": { status: "active", steps: [] } } }] })
  chat.topicHandles = [topic.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain halves", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  await workspace.mutate((state) => { state.chats.push(chat); state.topics.push(topic) })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: directory }], openedTopicId: topic.id, skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory }))
  const saveHandoff = workflows.saveHandoff.bind(workflows)
  let failOnce = true
  workflows.saveHandoff = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error("Interrupted after lesson commit") }
    return saveHandoff(...args)
  }
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const walkthrough = [
    "Two equal halves make one whole.",
    "",
    "```mermaid",
    'pie title One whole',
    '  "First half" : 1',
    '  "Second half" : 1',
    "```",
    "",
    "---",
    "",
    "Each half is one of two equal pieces.",
    "",
    "| Piece | Share |",
    "|---|---|",
    "| First | 1/2 |",
    "| Second | 1/2 |",
  ].join("\n")
  let calls = 0
  const graph = createTutorGraph(workflows, async (input, session) => {
    calls += 1
    assert.match(session.instructions, /Save new or revised topic walkthroughs separately/)
    const edited = await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "halves-walkthrough", sectionId: "tp-halves", content: [walkthrough] } }] })
    assert.equal(edited.success, true, edited.text)
    await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", workpad: "Explained halves", nextAction: "Wait" })
    return session.finish("Two equal halves make one whole.")
  }, saver, {})
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  await assert.rejects(graph.invoke({ chatId: chat.id, turnId: turn.turnId }, config), /Interrupted after lesson commit/)
  await graph.invoke(null, config)
  assert.equal(calls, 1)
  const blocks = TopicStateSchema.parse(workspace.topic(topic.id).state).document?.blocks
  assert.equal(blocks?.length, 1)
  assert.deepEqual(blocks?.[0], { type: "markdown", id: "halves-walkthrough", sectionId: "tp-halves", content: [walkthrough] })
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Two equal halves make one whole.")
})
