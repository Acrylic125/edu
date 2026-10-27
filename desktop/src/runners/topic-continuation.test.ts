import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { newChat, newScratchpad, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"
import { topicMention } from "../shared/topic-mentions"

test("a confirmed topic continuation reaches its isolated role in one model invocation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-continuation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("Vector spaces")
  const material = { id: randomUUID(), name: "lecture.pdf", kind: "pdf" as const, text: "Vector spaces and subspaces", pages: ["Vector addition", "Subspace test"] }
  scratchpad.planConfirmed = true
  scratchpad.materials = [material]
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, content: [
    { id: "tp-vectors", name: "6.1 Vector spaces", references: [{ type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 1, to: 1 }] }], goals: [], mistakes: [] },
    { id: "tp-subspaces", name: "6.2 Subspaces", references: [{ type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 2, to: 2 }] }], goals: [], mistakes: [] },
  ], threadTutors: [{ id: chat.id, progress: { "tp-vectors": { status: "active", steps: [{ question: "Are nonnegative robot displacements closed under addition?" }] } } }] })
  const answer = "Adding two nonnegative coordinates still gives nonnegative coordinates."
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push(
    { id: randomUUID(), role: "user", content: answer, createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] },
    { id: randomUUID(), role: "user", content: "Teach section 6.2 briefly, then ask one understanding check.", createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] },
  )
  chat.learning = { ...chat.learning, phase: "awaiting_answer", currentSection: "lecture.pdf section 6.1, page 1", pendingQuestion: "Are nonnegative robot displacements closed under addition?", pendingCheck: { scratchpadId: scratchpad.id, scratchpadPartId: "tp-vectors", stepIndex: 0 }, privateAnswerKey: "Nonnegative coordinates sum to nonnegative coordinates.", nextAction: "Assess closure, then continue", workpad: "Robot displacement example; remaining vector space axioms are open." }
  const assets = join(directory, "scratchpads", scratchpad.id, "assets")
  await mkdir(assets, { recursive: true })
  await writeFile(join(assets, material.name), material.text)
  await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(scratchpad) })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  let coordinatorRuns = 0
  let roleRuns = 0
  await createTutorGraph(workflows, async (input, session) => {
    const tools = session.tools.flatMap((tool) => tool.type === "function" ? [tool.function.name] : [])
    if (tools.includes("assume_role")) {
      coordinatorRuns += 1
      const delegated = await session.execute("assume_role", { requests: [{
        target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Follow the latest learner request", requestedAccess: "write", replyToLearner: true,
        context: { learnerMessageIds: chat.messages.map((message) => message.id), materialIds: [material.id], readDependencies: [], relevantContext: "" },
      }] })
      assert.equal(delegated.success, true, delegated.text)
      return session.finish("")
    }
    roleRuns += 1
    assert.ok(tools.includes("topic_recordAnswer"))
    assert.equal(tools.includes("topic_createTopic"), false)
    assert.equal(tools.some((name) => name.startsWith("generic_")), false)
    assert.deepEqual(input.chat.messages.map(({ id, content }) => ({ id, content })), chat.messages.map(({ id, content }) => ({ id, content })))
    assert.deepEqual(input.chat.learning, chat.learning)
    assert.match(session.instructions, new RegExp(material.id))
    const recorded = await session.execute("topic_recordAnswer", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-vectors", stepIndex: 0, answerFromUser: answer })
    assert.equal(recorded.success, true, recorded.text)
    const active = await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-subspaces" })
    assert.equal(active.success, true, active.text)
    const question = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-subspaces", question: "Does a robot constraint excluding zero describe a subspace? Explain." })
    assert.equal(question.success, true, question.text)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", currentSection: "lecture.pdf section 6.2, page 2", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-subspaces", stepIndex: 0 }, nextAction: "Wait for the subspace explanation", workpad: "Closure explanation recorded; earlier vector space axioms remain open." })
    assert.equal(saved.success, true, saved.text)
    return session.finish("A subspace must include zero and preserve the vector operations.")
  }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(coordinatorRuns, 0, "An active single-topic lesson must not wait for a routing model")
  assert.equal(roleRuns, 1)
  const state = TopicStateSchema.parse(workspace.scratchpad(scratchpad.id).state)
  assert.equal(state.threadTutors[0].progress["tp-vectors"].steps[0].answerFromUser, answer)
  assert.equal(state.threadTutors[0].progress["tp-subspaces"].steps.length, 1)
  assert.match(workflows.complete(chat.id, turn.turnId).message.content, /subspace/i)
})

test("an unrelated request returns from the topic role to coordination before any writes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-coordination-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("Fractions")
  scratchpad.planConfirmed = true
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Create a generic scratchpad for travel notes.", createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] })
  await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(scratchpad) })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const phases: string[] = []
  await createTutorGraph(workflows, async (input, session) => {
    const tools = session.tools.flatMap((tool) => tool.type === "function" ? [tool.function.name] : [])
    if (tools.includes("topic_editContent")) {
      phases.push("topic")
      const result = await session.execute("finish_role", { summary: "The learner requests a new generic scratchpad for travel notes.", evidence: [], needsCoordination: true })
      assert.equal(result.success, true, result.text)
      return session.finish("")
    }
    if (tools.includes("assume_role")) {
      phases.push("coordinator")
      assert.match(session.instructions, /requests a new generic scratchpad for travel notes/)
      const result = await session.execute("assume_role", { requests: [{ target: { mode: "create", type: "generic" }, task: "Create travel notes", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" } }] })
      assert.equal(result.success, true, result.text)
      return session.finish("")
    }
    phases.push("generic")
    const created = await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Travel notes", references: [] } })
    assert.equal(created.success, true, created.text)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", nextAction: "Wait for travel notes", workpad: "Created travel notes" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("Your travel notes are ready.")
  }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.deepEqual(phases, ["topic", "coordinator", "generic"])
  assert.equal(workflows.get(chat.id, turn.turnId).batches[0].jobs[0].operations.length, 0)
  assert.deepEqual(workspace.scratchpad(scratchpad.id).state, scratchpad.state)
  assert.equal(workspace.stateSnapshot.scratchpads.length, 2)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Your travel notes are ready.")
})

test("drafts, archived targets, commands, multiple targets, and large contexts retain coordination", async (t) => {
  for (const scenario of ["draft", "archived", "command", "multiple", "large"] as const) {
    await t.test(scenario, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "edu-topic-routing-"))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const workspace = new WorkspaceRepository(directory)
      await workspace.load()
      const runner = workspace.stateSnapshot.runners[0]
      const chat = newChat(runner.id)
      const scratchpad = newScratchpad("Fractions")
      const other = newScratchpad("Geometry")
      scratchpad.planConfirmed = scenario !== "draft"
      scratchpad.archived = scenario === "archived"
      chat.scratchpadHandles = [scratchpad.id, other.id]
      let content = "Continue"
      if (scenario === "command") content = "/new-test Practice fractions"
      if (scenario === "multiple") content = `${topicMention(scratchpad.id, scratchpad.title)} ${topicMention(other.id, other.title)} Compare these topics`
      if (scenario === "large") content = "Earlier discussion. ".repeat(4000)
      chat.messages.push({ id: randomUUID(), role: "user", content, createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] })
      await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(scratchpad, other) })
      const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [scratchpad, other].map((scratchpad) => ({ ...scratchpad, assetDirectory: directory })), skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
      const workflows = new TutorWorkflowRepository(workspace)
      const turn = await workflows.start(job)
      const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
      t.after(() => saver.close())
      await assert.rejects(createTutorGraph(workflows, async (input, session) => {
        assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "topic_editContent"), false)
        throw new Error("Coordinator or compaction reached")
      }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" }), /Coordinator or compaction reached/)
    })
  }
})
