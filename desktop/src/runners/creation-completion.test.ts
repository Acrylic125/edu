import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"
import { TestStateSchema } from "../shared/scratchpad-state"
import { scratchpadOperationId } from "../shared/scratchpad-operation"
import { test, type TestContext } from "node:test"
import { newChat, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { createWorkflowRoleSession } from "./workflow-session"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"

async function workspaceFixture(t: TestContext, type: "test" | "generic") {
  const directory = await mkdtemp(join(tmpdir(), "edu-creation-completion-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const chat = newChat(workspace.stateSnapshot.runners[0].id)
  chat.messages.push({ id: randomUUID(), role: "user", content: `/new-${type} How agents load skills`, createdAt: new Date().toISOString(), topicIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner: workspace.stateSnapshot.runners[0], chat, topics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  return { directory, workspace, workflows, turn, job }
}

async function fixture(t: TestContext, type: "test" | "generic", replyToLearner = true) {
  const { workspace, workflows, turn, job } = await workspaceFixture(t, type)
  const chat = job.chat
  const batch = await workflows.assumeRole(chat.id, turn.turnId, randomUUID(), [{
    target: { mode: "create", type }, task: "Create a scratchpad or clarify missing scope", requestedAccess: "write", replyToLearner,
    context: { learnerMessageIds: [chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" },
  }])
  const role = batch.jobs[0]
  const context = await createWorkflowRoleSession(job, role, (mutation) => workflows.stage(chat.id, turn.turnId, role.jobId, randomUUID(), mutation), () => {})
  return { workspace, workflows, turn, batch, role, context, job }
}

for (const type of ["test", "generic"] as const) {
  for (const explicitFinish of [false, true]) {
    test(`${type} creation returns a saved clarification without writes (${explicitFinish ? "finish_role" : "direct reply"})`, async (t) => {
      const { workspace, workflows, turn, batch, role, context } = await fixture(t, type)
      const question = "Should the test cover all the notes or only a particular section?"
      const saved = await context.session.execute("save_learning_state", {
        ...context.job.chat.learning, phase: "awaiting_clarification", question,
        workpad: "Coverage is unspecified; no scratchpad has been created.", nextAction: "Wait for the learner's scope.",
      })
      assert.equal(saved.success, true, saved.text)
      if (explicitFinish) {
        const result = await context.session.execute("finish_role", { summary: question, evidence: [] })
        assert.equal(result.success, true, result.text)
      }
      context.session.finish("I found the notes, but need to confirm the scope.")
      assert.equal(context.output?.needsClarification, true)
      assert.equal(context.output?.response, undefined)
      assert.deepEqual(context.output?.evidence, [])
      assert.ok(context.output?.summary.includes(question))
      assert.ok(context.output)
      await workflows.ready(turn.chatId, turn.turnId, role.jobId, context.output)
      const receipt = await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
      assert.equal(receipt.results[0].needsClarification, true)
      assert.equal(workspace.stateSnapshot.topics.length, 0)
      assert.equal(workspace.chat(turn.chatId).messages.filter((message) => message.role === "assistant").length, 0)
    })
  }

  test(`${type} creation cannot report success without creating its target`, async (t) => {
    const { context } = await fixture(t, type)
    const saved = await context.session.execute("save_learning_state", {
      ...context.job.chat.learning, phase: "awaiting_choice", workpad: "Task complete.", nextAction: "Continue.",
    })
    assert.equal(saved.success, true, saved.text)
    assert.equal(context.session.saved, false)
    assert.match(context.session.saveError ?? "", /creat|stag/i)
    assert.throws(() => context.session.finish("Created your scratchpad."), /creat|stag/i)
    assert.equal(context.output, undefined)
  })

  test(`${type} creation with staged writes remains a completed task when its reply asks a clarification`, async (t) => {
    const { workspace, workflows, turn, batch, role, context } = await fixture(t, type)
    let created
    if (type === "test") {
      created = await context.session.execute("test_createTest", { test: { type: "test", version: "19-10-2026", name: "Agent skills", goals: [], questions: [], references: [], content: [] } })
    } else {
      created = await context.session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Agent skills", references: [] } })
    }
    assert.equal(created.success, true, created.text)
    const rejected = await context.session.execute("finish_role", { summary: "Which section?", evidence: [], needsClarification: true })
    assert.equal(rejected.success, false)
    assert.equal(context.output?.summary, undefined)
    const saved = await context.session.execute("save_learning_state", {
      ...context.job.chat.learning, phase: "awaiting_clarification", question: "Which section should we work on next?",
      workpad: "Created the scratchpad; the next section needs clarification.", nextAction: "Wait for the next section.",
    })
    assert.equal(saved.success, true, saved.text)
    assert.equal(context.session.saved, true)
    context.session.finish("Created the scratchpad.")
    const output = context.output
    assert.ok(output)
    assert.equal(output.needsClarification, undefined)
    assert.ok(output.response)
    await workflows.ready(turn.chatId, turn.turnId, role.jobId, output)
    await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
    assert.equal(workspace.stateSnapshot.topics.length, 1)
  })

  test(`${type} summary-only creation rejects an empty success and permits explicit clarification`, async (t) => {
    const { context } = await fixture(t, type, false)
    const rejected = await context.session.execute("finish_role", { summary: "Done", evidence: [] })
    assert.equal(rejected.success, false)
    assert.equal(context.session.saved, false)
    assert.equal(context.output?.summary, undefined)
    const clarified = await context.session.execute("finish_role", { summary: "Which scope should this cover?", evidence: [], needsClarification: true })
    assert.equal(clarified.success, true, clarified.text)
    assert.equal(context.output?.needsClarification, true)
  })
}


test("test creation clarification survives the complete workflow and publishes once", async (t) => {
  const { directory, workspace, workflows, turn, job } = await workspaceFixture(t, "test")
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const question = "Should the test cover all the notes or only a particular section?"
  let tutorCalls = 0
  let roleCalls = 0
  const graph = createTutorGraph(workflows, async (input, session) => {
    const isTutor = session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role")
    if (isTutor) {
      tutorCalls++
      if (tutorCalls === 1) {
        const delegated = await session.execute("assume_role", { requests: [{
          target: { mode: "create", type: "test" }, task: "Create the requested test", requestedAccess: "write", replyToLearner: true,
          context: { learnerMessageIds: [job.chat.messages[0].id], materialIds: [], readDependencies: [], relevantContext: "" },
        }] })
        assert.equal(delegated.success, true, delegated.text)
        return session.finish("")
      }
      assert.equal(tutorCalls, 2, "Clarification must return to Tutor without another creation attempt")
      assert.match(session.instructions, /needsClarification/)
    } else roleCalls++
    const saved = await session.execute("save_learning_state", {
      ...input.chat.learning, phase: "awaiting_clarification", question,
      workpad: "No scratchpad was created; scope needs clarification.", nextAction: "Wait for learner scope.",
    })
    assert.equal(saved.success, true, saved.text)
    return session.finish("I found the notes, but need to confirm the scope.")
  }, saver, {})
  await graph.invoke({ chatId: turn.chatId, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(roleCalls, 1)
  assert.equal(workspace.stateSnapshot.topics.length, 0)
  assert.equal(workspace.chat(turn.chatId).learning.phase, "awaiting_clarification")
  const result = workflows.complete(turn.chatId, turn.turnId)
  assert.ok(result.message.content.includes(question))
  assert.doesNotMatch(result.message.content, /\[!CHECK\]/)
  assert.deepEqual(result.message.topicIds, [])
  assert.equal(workspace.chat(turn.chatId).messages.filter((message) => message.role === "assistant").length, 1)
  assert.equal(workflows.complete(turn.chatId, turn.turnId).message.id, result.message.id)
})

test("a newly staged test can be updated later in the same task", async (t) => {
  const { workspace, workflows, turn, batch, role, context } = await fixture(t, "test")
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() })
  const createdAt = new Date().toISOString()
  const created = await context.session.execute("test_createTest", { test: { type: "test", version: "19-10-2026", name: "Agent skills", goals: [], questions: [], references: [], content: [] } })
  assert.equal(created.success, true, created.text)
  const read = await context.session.execute("read_scratchpad", { scratchpadId: role.scratchpadHandle })
  assert.equal(read.success, true, read.text)
  const original = z.object({ state: TestStateSchema }).parse(JSON.parse(read.text))
  t.mock.timers.tick(100)
  const updated = await context.session.execute("test_updateTest", { testId: role.scratchpadHandle, content: [{ id: "tp-loading", name: "Skill loading", references: [], goals: [], mistakes: [] }] })
  assert.equal(updated.success, true, updated.text)
  await assert.rejects(workflows.stage(turn.chatId, turn.turnId, role.jobId, "stale-update", { type: "updateTest", topicId: role.scratchpadId, expectedState: original.state, name: "Stale title" }), /Test changed during this turn/)
  t.mock.timers.tick(100)
  const updatedAgain = await context.session.execute("test_updateTest", { testId: role.scratchpadHandle, name: "Agent skills assessment" })
  assert.equal(updatedAgain.success, true, updatedAgain.text)
  const saved = await context.session.execute("save_learning_state", { ...context.job.chat.learning, phase: "ready_to_continue", workpad: "Created and updated the assessment.", nextAction: "Continue the test." })
  assert.equal(saved.success, true, saved.text)
  context.session.finish("Created the assessment.")
  assert.ok(context.output)
  await workflows.ready(turn.chatId, turn.turnId, role.jobId, context.output)
  t.mock.timers.tick(100)
  await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  const result = workspace.topic(role.scratchpadId)
  assert.equal(result.createdAt, createdAt)
  assert.equal(result.state?.createdAt, createdAt)
  assert.equal(result.title, "Agent skills assessment")
  assert.equal(result.state?.type === "test" && result.state.content[0].name, "Skill loading")
})


test("creation timestamps do not change logical operation identity", () => {
  const mutation = { type: "createTest" as const, topicId: randomUUID(), test: { type: "test" as const, version: "19-10-2026" as const, name: "Agent skills", goals: [], questions: [], references: [], content: [] } }
  assert.equal(scratchpadOperationId("stage", { ...mutation, createdAt: "2026-10-27T00:00:00.000Z" }), scratchpadOperationId("stage", { ...mutation, createdAt: "2026-10-27T00:01:00.000Z" }))
})


test("a saved creation from before timestamp metadata can recover and update", async (t) => {
  const { workflows, turn, role, job } = await fixture(t, "test")
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() })
  await workflows.stage(turn.chatId, turn.turnId, role.jobId, "legacy-create", { type: "createTest", topicId: role.scratchpadId, test: { type: "test", version: "19-10-2026", name: "Agent skills", goals: [], questions: [], references: [], content: [] } })
  t.mock.timers.tick(100)
  const recovered = workflows.get(turn.chatId, turn.turnId).batches[0].jobs[0]
  const { session } = await createWorkflowRoleSession(job, recovered, (mutation) => workflows.stage(turn.chatId, turn.turnId, role.jobId, scratchpadOperationId(role.stageId, mutation), mutation), () => {})
  t.mock.timers.tick(100)
  const updated = await session.execute("test_updateTest", { testId: role.scratchpadHandle, name: "Recovered assessment" })
  assert.equal(updated.success, true, updated.text)
})
