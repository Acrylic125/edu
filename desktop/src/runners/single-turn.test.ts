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
import { createWorkflowRoleSession, createWorkflowTutorSession } from "./workflow-session"
import { RoleJobSchema } from "../shared/tutor-workflow"

test("the chat teaching role retains the slide position and pending check across learner turns", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [
    { id: "tp-halves", name: "1. Halves", references: [], goals: [], mistakes: [] },
    { id: "tp-quarters", name: "2. Quarters", references: [], goals: [], mistakes: [] },
  ], threadTutors: [{ id: chat.id, progress: {
    "tp-halves": { status: "active", steps: [] },
    "tp-quarters": { status: "active", steps: [{ question: "How many quarters make a half?" }] },
  } }] })
  chat.topicHandles = [topic.id]
  chat.learning = { ...chat.learning, phase: "awaiting_answer", currentSection: "fractions.pdf, section 2, page 6",
    outline: ["1. Halves", "2. Quarters"], pendingQuestion: "How many quarters make a half?",
    pendingCheck: { topicId: topic.id, topicPartId: "tp-quarters", stepIndex: 0 },
    privateAnswerKey: "Two quarters", workpad: "Already explained the source example on page 6.",
    nextAction: "Give feedback, then continue the example on page 7.",
  }
  chat.messages.push({ id: randomUUID(), role: "user", content: "Two", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: topic.id, scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "existing", snapshot: topic, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Give feedback and continue", requestedAccess: "write", replyToLearner: true,
      context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "Continue the lesson" } },
  })
  const context = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  assert.deepEqual(context.job.chat.learning, chat.learning, "The reply writer needs the exact saved slide cursor and pending check")
  assert.match(context.session.instructions, /fractions\.pdf, section 2, page 6/)
  assert.match(context.session.instructions, /Give feedback, then continue the example on page 7/)
  assert.match(context.session.instructions, /"topicId":"scratchpad_1","topicPartId":"tp-quarters","stepIndex":0/)
  assert.equal(context.session.instructions.includes(topic.id), false, "Private handoff topic IDs use scoped handles")

  const summary = await createWorkflowRoleSession(job, { ...role, request: { ...role.request, replyToLearner: false } }, async () => {}, () => {})
  assert.equal(summary.job.chat.learning.currentSection, "")
  assert.equal(summary.session.instructions.includes(chat.learning.privateAnswerKey), false, "Summary roles do not receive private assessment keys")

  const other = newTopic("Unrelated lesson")
  other.planConfirmed = true
  job.topics.push({ ...other, assetDirectory: "/tmp" })
  job.chat.topicHandles.push(other.id)
  const unrelated = await createWorkflowRoleSession(job, { ...role, scratchpadId: other.id, scratchpadHandle: "scratchpad_2", snapshot: other,
    request: { ...role.request, target: { mode: "existing", scratchpadHandle: "scratchpad_2" } },
  }, async () => {}, () => {})
  assert.equal(unrelated.job.chat.learning.currentSection, "")
  assert.equal(unrelated.job.chat.learning.pendingCheck, undefined)
  assert.equal(unrelated.session.instructions.includes(chat.learning.privateAnswerKey), false, "A different lesson does not inherit the current lesson's answer key")
})

test("both chat reply paths receive the source walkthrough instructions", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  topic.planConfirmed = true
  chat.topicHandles = [topic.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: topic.id, scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "existing", snapshot: topic, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Teach the next slide", requestedAccess: "write", replyToLearner: true,
      context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } },
  })
  const coordinator = await createWorkflowTutorSession(job, [], "", () => {})
  const writer = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  for (const { session } of [coordinator, writer]) {
    assert.match(session.instructions, /slides define the lesson sequence/)
    assert.match(session.instructions, /Teach the source's examples, values and code/)
    assert.match(session.instructions, /Make each teaching reply self-contained/)
    assert.match(session.instructions, /Save the current learning objective and exact source section, page, and position within an example in currentSection/)
  }
})

test("the chat coordinator can grant slides stored with the current topic without preloading their text", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  topic.planConfirmed = true
  const material = { id: randomUUID(), name: "fractions.pdf", kind: "pdf" as const, text: "PRIVATE_SLIDE_TEXT", pages: ["PRIVATE_SLIDE_TEXT"] }
  topic.materials = [material]
  chat.topicHandles = [topic.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], openedTopicId: topic.id, skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const { session } = await createWorkflowTutorSession(job, [], "", () => {})
  assert.ok(session.instructions.includes(material.id), "The coordinator needs the source ID to grant it to the chat reply writer")
  assert.ok(session.instructions.includes(material.name))
  assert.equal(session.instructions.includes(material.text), false)
})

test("ordinary teaching assumes an isolated role and publishes its response without a Tutor rewrite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-single-turn-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  const unrelatedDraft = newTopic("Unrelated draft")
  const previousTopic = newTopic("Previous topic")
  previousTopic.planConfirmed = true
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{ id: "tp-halves", name: "Halves", references: [{ type: "website", url: "https://example.com/fractions" }], goals: [], mistakes: [] }] })
  chat.topicHandles = [topic.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain halves", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  await workspace.mutate((state) => { state.chats.push(chat); state.topics.push(topic, unrelatedDraft, previousTopic) })
  const job = WorkerJobSchema.parse({ runner, chat, topics: [topic, unrelatedDraft, previousTopic].map((topic) => ({ ...topic, assetDirectory: directory })), openedTopicId: topic.id, skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  let invocations = 0
  await createTutorGraph(workflows, async (input, session) => {
    invocations += 1
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role")) {
      assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "topic_editContent"), false)
      const delegated = await session.execute("assume_role", { requests: [{ target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Teach halves and reply to the learner", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "Continue the requested lesson" } }] })
      assert.equal(delegated.success, true, delegated.text)
      return session.finish("")
    }
    assert.deepEqual(input.topics.map((target) => target.id), [topic.id], "Only the assigned target enters the role")
    assert.equal(input.workspaceTopics.some((target) => target.id === previousTopic.id), false, "Ungranted history stays out of the role")
    assert.match(session.instructions, /# Manage Topic/)
    assert.doesNotMatch(session.instructions, /# Manage Test|# Manage Generic|## Vary the rhythm/)
    assert.equal(workflows.get(chat.id, turn.turnId).batches[0].jobs.length, 1)
    assert.ok(session.tools.some((tool) => tool.type === "function" && tool.function.name === "topic_editContent"), "Topic management tools belong in the role subgraph")
    const edit = await session.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "halves", sectionId: "tp-halves", content: ["Two equal halves make one whole."] } }], present: ["halves"] })
    assert.equal(edit.success, true, edit.text)
    assert.equal(workflows.get(chat.id, turn.turnId).batches[0].jobs[0].operations.length, 1, "Writes are durable before the tool succeeds")
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", workpad: "Explained halves", nextAction: "Wait for the learner" })
    assert.equal(saved.success, true, saved.text)
    return { ...session.finish(""), providerSession: { provider: "codex", threadId: "single-session", home: directory, executable: "/codex", toolVersion: 24, status: "ready" } }
  }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(invocations, 1)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Two equal halves make one whole.")
  assert.equal(workspace.chat(chat.id).providerSession, undefined, "An isolated role session must not be resumed as the parent Tutor")
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
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role")) {
      await session.execute("assume_role", { requests: [{ target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Teach halves and reply", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" } }] })
      return session.finish("")
    }
    assert.match(session.instructions, /# Manage Topic/)
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
