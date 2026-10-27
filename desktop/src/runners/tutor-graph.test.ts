import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { newChat, newScratchpad, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { createTutorGraph, type WorkflowNativeRunner } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"
import { TopicStateSchema } from "../shared/topic-state"
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph"
import { z } from "zod"
import { TutorDecisionSchema } from "../shared/tutor-workflow"

test("Retry renders committed lesson blocks when the worker supplies its original job as connection settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-committed-lesson-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("Fractions")
  scratchpad.planConfirmed = true
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, content: [{ id: "tp-halves", name: "Halves", references: [{ type: "website", url: "https://example.com/fractions" }], goals: [], mistakes: [] }] })
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain halves", createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] })
  await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(scratchpad) })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  let roleRuns = 0
  let interrupted = false
  const lesson = "Two equal halves make one whole."
  const saveHandoff = workflows.saveHandoff.bind(workflows)
  t.mock.method(workflows, "saveHandoff", async (...args: Parameters<typeof workflows.saveHandoff>) => {
    if (!interrupted) { interrupted = true; throw new Error("Provider interrupted after commit") }
    return saveHandoff(...args)
  })
  const native: WorkflowNativeRunner = async (input, session) => {
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role")) {
      await session.execute("assume_role", { requests: [{ target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Teach halves and reply", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" } }] })
      return session.finish("")
    }
    roleRuns += 1
    const edit = await session.execute("topic_editContent", { scratchpadId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "halves-lesson", sectionId: "tp-halves", content: [lesson] } }], present: ["halves-lesson"] })
    assert.equal(edit.success, true, edit.text)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", nextAction: "Wait for learner", workpad: "Explained halves" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("")
  }
  const path = join(directory, "checkpoints.sqlite")
  const saver = new SqliteCheckpointSaver(path)
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  await assert.rejects(createTutorGraph(workflows, native, saver, job).invoke({ chatId: chat.id, turnId: turn.turnId }, config), /Provider interrupted after commit/)
  saver.close()
  const resumedSaver = new SqliteCheckpointSaver(path)
  t.after(() => resumedSaver.close())
  await createTutorGraph(workflows, native, resumedSaver, job).invoke(null, config)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, lesson)
  assert.equal(roleRuns, 1)
})

test("a graph commits role work before Tutor continues and resumes a failed reply without repeating that work", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-graph-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "/new-generic Create notes on fractions", createdAt: new Date().toISOString(), scratchpadIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const run: WorkflowNativeRunner = async (input, session) => {
    const names = session.tools.map((tool) => tool.type === "function" ? tool.function.name : "")
    if (names.includes("finish_role")) {
      const result = await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] } })
      assert.equal(result.success, true, result.text)
      await session.execute("finish_role", { summary: "Created fraction notes", evidence: [] })
      return session.finish("")
    }
    if (!session.instructions.includes("Created fraction notes")) {
      await session.execute("assume_role", { requests: [{ target: { mode: "create", type: "generic" }, task: "Create fraction notes", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } }] })
      return session.finish("")
    }
    assert.equal(workspace.stateSnapshot.scratchpads.length, 1)
    throw new Error("Provider disconnected while replying")
  }
  const path = join(directory, "checkpoints.sqlite")
  const saver = new SqliteCheckpointSaver(path)
  const graph = createTutorGraph(workflows, run, saver, {})
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  await assert.rejects(graph.invoke({ chatId: turn.chatId, turnId: turn.turnId }, config), /Provider disconnected/)
  saver.close()
  assert.equal(workspace.stateSnapshot.scratchpads.length, 1)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const recovered = new TutorWorkflowRepository(reopened)
  const resumeSaver = new SqliteCheckpointSaver(path)
  t.after(() => resumeSaver.close())
  const resumed = createTutorGraph(recovered, async (input, session) => {
    assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "finish_role"), false)
    assert.match(session.instructions, /Created fraction notes/)
    const result = await session.execute("save_learning_state", { ...input.chat.learning, nextAction: "Wait for the learner", workpad: "Fraction notes were created." })
    assert.equal(result.success, true, result.text)
    return session.finish("Your fraction notes are ready.")
  }, resumeSaver, {})
  await resumed.invoke(null, config)
  assert.equal(recovered.complete(turn.chatId, turn.turnId).message.content, "Your fraction notes are ready.")
  assert.equal(reopened.stateSnapshot.scratchpads.length, 1)
})

test("a checkpoint in the retired fast path resumes staged work inside its role subgraph", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-legacy-turn-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const target = newScratchpad("Fractions", "generic")
  chat.scratchpadHandles = [target.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Update fraction notes", scratchpadIds: [target.id], createdAt: new Date().toISOString() })
  await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(target) })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...target, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory }))
  const batch = await workflows.assumeRole(chat.id, turn.turnId, turn.turnId, [{ target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Finish the saved notes", requestedAccess: "write", context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" } }])
  await workflows.stage(chat.id, turn.turnId, batch.jobs[0].jobId, "original-notes", { type: "updateGeneric", scratchpadId: target.id, summary: "# Fractions\n\nOriginal staged notes" })
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  const legacy = new StateGraph(new StateSchema({ chatId: z.string(), turnId: z.string() }))
    .addNode("single_tutor", async () => { throw new Error("Interrupted legacy run") })
    .addEdge(START, "single_tutor").addEdge("single_tutor", END).compile({ checkpointer: saver })
  await assert.rejects(legacy.invoke({ chatId: chat.id, turnId: turn.turnId }, config), /Interrupted legacy/)
  let roleRuns = 0
  await createTutorGraph(workflows, async (input, session) => {
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "finish_role")) {
      roleRuns += 1
      assert.match(session.instructions, /Earlier staged writes are already applied/)
      const result = await session.execute("finish_role", { summary: "Recovered fraction notes", evidence: [] })
      assert.equal(result.success, true, result.text)
      return session.finish("")
    }
    assert.equal(session.tools.some((tool) => tool.type === "function" && tool.function.name === "generic_updateScratchpad"), false)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, workpad: "Recovered the notes", nextAction: "Wait" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("Your fraction notes are ready.")
  }, saver, {}).invoke(null, config)
  assert.equal(roleRuns, 1)
  assert.match(workspace.scratchpad(target.id).learning.notes, /Original staged notes/)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Your fraction notes are ready.")
})

test("compaction preserves recent messages and persists a covered history summary without deleting the conversation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-compact-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push(
    { id: randomUUID(), role: "user", content: `I want to understand fractions. ${"Earlier discussion. ".repeat(9_000)}`, createdAt: new Date().toISOString(), scratchpadIds: [] },
    { id: randomUUID(), role: "assistant", content: "We compared halves and quarters.", createdAt: new Date().toISOString(), scratchpadIds: [] },
    { id: randomUUID(), role: "user", content: "Why is one half two quarters?", createdAt: new Date().toISOString(), scratchpadIds: [] },
  )
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const graph = createTutorGraph(workflows, async (input, session) => {
    if (!session.tools.length) return session.finish("The learner wants to understand fractions and has compared halves and quarters.")
    assert.deepEqual(input.chat.messages.map((message) => message.id), chat.messages.slice(1).map((message) => message.id))
    assert.match(session.instructions, /learner wants to understand fractions/)
    await session.execute("save_learning_state", { ...input.chat.learning, nextAction: "Wait for an answer", workpad: "Explained equivalent fractions." })
    return session.finish("Splitting each half in two gives two quarters.")
  }, saver, {}, () => {}, { maxInputTokens: 100_000, reserveTokens: 12_000, recentMessages: 2 })
  await graph.invoke({ chatId: turn.chatId, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(workspace.chat(chat.id).messages.length, 4)
  const saved = workflows.get(turn.chatId, turn.turnId)
  assert.equal(saved.summary?.coveredThroughMessageId, chat.messages[0].id)
  assert.equal(saved.summary?.summary, "The learner wants to understand fractions and has compared halves and quarters.")
})

test("parallel roles join before commit and recovery reuses a successful sibling", { timeout: 10_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-parallel-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  const targets = [newScratchpad("Halves", "generic"), newScratchpad("Quarters", "generic")]
  chat.scratchpadHandles = targets.map((target) => target.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "/new-generic Create notes on halves and quarters", createdAt: new Date().toISOString(), scratchpadIds: targets.map((target) => target.id) })
  await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(...targets) })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: targets.map((target) => ({ ...target, assetDirectory: directory })), skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const bothStarted = Promise.withResolvers<void>()
  const seen = new Set<string>()
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  const graph = createTutorGraph(workflows, async (input, session) => {
    if (!session.tools.some((tool) => tool.type === "function" && tool.function.name === "finish_role")) {
      await session.execute("assume_role", { requests: targets.map((target, index) => ({ target: { mode: "create", type: "generic" }, task: `Create ${target.title}`, requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } })) })
      return session.finish("")
    }
    const title = session.instructions.includes("Task: Create Halves") ? "Halves" : "Quarters"
    seen.add(title)
    if (seen.size === 2) bothStarted.resolve()
    await bothStarted.promise
    if (title === "Quarters") {
      await new Promise((resolve) => setTimeout(resolve, 60))
      throw new Error("Quarters provider disconnected")
    }
    await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Halves notes", references: [] } })
    await session.execute("finish_role", { summary: "Read halves", evidence: [] })
    return session.finish("")
  }, saver, {})
  await assert.rejects(graph.invoke({ chatId: turn.chatId, turnId: turn.turnId }, config), /Quarters provider disconnected/)
  saver.close()
  assert.equal(workflows.get(turn.chatId, turn.turnId).batches[0].receipt, undefined)
  assert.deepEqual(workflows.get(turn.chatId, turn.turnId).batches[0].jobs.map((job) => job.status), ["ready", "working"])
  const resumedSaver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => resumedSaver.close())
  const resumed = createTutorGraph(workflows, async (input, session) => {
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "finish_role")) {
      assert.match(session.instructions, /Task: Create Quarters/)
      await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Quarters notes", references: [] } })
      await session.execute("finish_role", { summary: "Read quarters", evidence: [] })
      return session.finish("")
    }
    assert.match(session.instructions, /Read halves/)
    assert.match(session.instructions, /Read quarters/)
    await session.execute("save_learning_state", { ...input.chat.learning, workpad: "Both notes read", nextAction: "Wait for learner" })
    return session.finish("Both notes are available.")
  }, resumedSaver, {})
  await resumed.invoke(null, config)
  assert.equal(workflows.get(turn.chatId, turn.turnId).batches[0].receipt?.results.length, 2)
})


test("Retry repairs a legacy invalid creation delegation instead of replaying its failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-invalid-delegation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "/new-test Test me on MIPS Part 1", createdAt: new Date().toISOString(), scratchpadIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const request = { target: { mode: "create" as const, type: "test" as const }, task: "Create a test on MIPS Part 1", requestedAccess: "read" as const, replyToLearner: true,
    context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" } }
  const path = join(directory, "checkpoints.sqlite")
  const saver = new SqliteCheckpointSaver(path)
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  const legacy = new StateGraph(new StateSchema({ chatId: z.string(), turnId: z.string(), decision: TutorDecisionSchema.optional() }))
    .addNode("tutor", async () => ({ decision: TutorDecisionSchema.parse({ action: "delegate", requests: [request] }) }))
    .addNode("assume_role", async () => { await workflows.assumeRole(chat.id, turn.turnId, turn.turnId, [request]); return {} })
    .addEdge(START, "tutor").addEdge("tutor", "assume_role").addEdge("assume_role", END).compile({ checkpointer: saver })
  await assert.rejects(legacy.invoke({ chatId: chat.id, turnId: turn.turnId }, config), /independent write role|Creation requires write access/)
  saver.close()
  const resumed = new SqliteCheckpointSaver(path)
  t.after(() => resumed.close())
  let tutorRuns = 0
  let roleRuns = 0
  await createTutorGraph(workflows, async (input, session) => {
    if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role")) {
      tutorRuns += 1
      assert.match(session.instructions, /rejected delegation/i)
      assert.match(session.instructions, /Creation requires write access/)
      const delegated = await session.execute("assume_role", { requests: [{ ...request, requestedAccess: "write" }] })
      assert.equal(delegated.success, true, delegated.text)
      return session.finish("")
    }
    roleRuns += 1
    const created = await session.execute("test_createTest", { test: { type: "test", version: "19-10-2026", name: "MIPS Part 1", goals: [], questions: [], references: [], content: [] } })
    assert.equal(created.success, true, created.text)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, workpad: "Created MIPS test", nextAction: "Wait for learner" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("Your MIPS test is ready.")
  }, resumed, {}).invoke(null, config)
  assert.equal(tutorRuns, 1)
  assert.equal(roleRuns, 1)
  assert.equal(workflows.complete(chat.id, turn.turnId).message.content, "Your MIPS test is ready.")
  assert.equal(workflows.get(chat.id, turn.turnId).batches.length, 1)
  assert.equal(workspace.stateSnapshot.scratchpads.length, 1)
})
