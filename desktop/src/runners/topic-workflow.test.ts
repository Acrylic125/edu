import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newScratchpad, WorkspaceRepository } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { RoleJobSchema } from "../shared/tutor-workflow"
import { TopicStateSchema, TopicMutationSchema } from "../shared/topic-state"
import { createWorkflowRoleSession } from "./workflow-session"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { applyTopicMutation } from "../main/state-service"

async function fixture(criteria = ["Explains bounded work"]) {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("MIPS")
  scratchpad.planConfirmed = true
  const check = { goalIndex: 0, criterionIndex: 0, reasoningTask: "Explain a page range", missingEvidence: "Per-job bounds", expectedEvidence: "Bounded work" }
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state, content: [
    { id: "tp-section-2", name: "5.2", references: [], mistakes: [], goals: [{ objective: "Bound work", understoodWhen: criteria }] },
    { id: "tp-section-5", name: "5.5", references: [], mistakes: [], goals: [] },
  ], threadTutors: [{ id: chat.id, progress: { "tp-section-2": { status: "active", steps: [{ question: "Why use a page range?", check }] } } }] })
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "It bounds each job's input", createdAt: chat.createdAt, scratchpadIds: [scratchpad.id] })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: scratchpad.id, scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "existing", snapshot: scratchpad, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Assess then continue", requestedAccess: "write", replyToLearner: true,
      context: { learnerMessageIds: chat.messages.map((message) => message.id), materialIds: [], readDependencies: [], relevantContext: "" } } })
  const mutations: Parameters<typeof applyTopicMutation>[2][] = []
  const context = await createWorkflowRoleSession(job, role, async (mutation) => {
    mutations.push(TopicMutationSchema.parse(mutation))
  }, () => {})
  const target = { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-2" }
  const answer = { ...target, stepIndex: 0, answerFromUser: chat.messages[0].content, assessment: {
    goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: chat.messages[0].content }], interpretation: "Identifies per-job input bounds", remainingGap: "",
  } }
  return { ...context, job, role, mutations, target, answer }
}

test("Topic applies completion before returning an answer tool result even when the agent omits complete", async () => {
  const { session, mutations, answer } = await fixture()
  const recorded = await session.execute("topic_recordAnswer", answer)
  assert.equal(recorded.success, true, recorded.text)
  assert.deepEqual(mutations.map((mutation) => mutation.type), ["recordAnswer", "complete"])
  assert.match(recorded.text, /completed/)
  const next = await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-5" })
  assert.equal(next.success, true, next.text)
  assert.deepEqual(mutations.map((mutation) => mutation.type), ["recordAnswer", "complete", "activatePart"])
})

test("Topic scope growth reopens completion and preserves evidence for unchanged criteria", async () => {
  const { session, answer, mutations, job } = await fixture()
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  const original = TopicStateSchema.parse(job.scratchpads[0].state)
  const updated = await session.execute("topic_updateTopic", { scratchpadId: "scratchpad_1", changes: [
    { action: "update", id: "tp-section-2", patch: { goals: [{ ...original.content[0].goals[0], understoodWhen: ["Explains bounded work", "Explains concurrency"] }] } },
    { action: "add", part: { id: "tp-concurrency", name: "Concurrency", references: [], goals: [], mistakes: [] }, afterId: "tp-section-2" },
  ] })
  assert.equal(updated.success, true, updated.text)
  assert.match(updated.text, /scope changed/)
  const state = structuredClone(job)
  for (const mutation of mutations) applyTopicMutation({ chats: [state.chat], scratchpads: state.scratchpads }, state.chat.id, mutation)
  const topic = TopicStateSchema.parse(state.scratchpads[0].state)
  assert.deepEqual(topic.content.map((part) => part.id), ["tp-section-2", "tp-concurrency", "tp-section-5"])
  const progress = topic.threadTutors[0].progress["tp-section-2"]
  assert.equal(progress.status, "active")
  assert.deepEqual(progress.steps[0].assessment, answer.assessment)
  assert.equal(progress.steps[0].reviewStartIndex ?? 0, 0)
})

test("Topic removal excludes historical checks from continuation and rejects their stale handoff", async () => {
  const { session, job } = await fixture()
  const removed = await session.execute("topic_updateTopic", { scratchpadId: "scratchpad_1", changes: [{ action: "remove", id: "tp-section-2" }] })
  assert.equal(removed.success, true, removed.text)
  const next = await session.execute("topic_whatIsNext", { scratchpadId: "scratchpad_1" })
  const options = z.array(z.object({ part: z.object({ id: z.string() }) })).parse(JSON.parse(next.text))
  assert.deepEqual(options.map((option) => option.part.id), ["tp-section-5"])
  const stale = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_answer", privateAnswerKey: "A bounded input", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-2", stepIndex: 0 } })
  assert.equal(stale.success, false)
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Teach 5.5" })
  assert.equal(saved.success, true, saved.text)
  assert.equal(session.saved, true, session.saveError ?? "A fresh continuation handoff must be publishable")
})

test("changed criteria retain historical answers without crediting or displaying their old checks", async () => {
  const { session, answer, job, mutations } = await fixture()
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  const changed = await session.execute("topic_updateTopic", { scratchpadId: "scratchpad_1", changes: [
    { action: "update", id: "tp-section-2", patch: { goals: [{ objective: "Choose concurrency", understoodWhen: ["Explain concurrency trade-offs"] }] } },
  ] })
  assert.equal(changed.success, true, changed.text)
  const workspace = structuredClone({ chats: [job.chat], scratchpads: job.scratchpads })
  for (const mutation of mutations) applyTopicMutation(workspace, job.chat.id, mutation)
  const progress = TopicStateSchema.parse(workspace.scratchpads[0].state).threadTutors[0].progress["tp-section-2"]
  assert.equal(progress.status, "active")
  assert.equal(progress.steps[0].answerFromUser, answer.answerFromUser)
  assert.equal(progress.steps[0].reviewStartIndex, 1)
  const stale = await session.execute("save_learning_state", { ...job.chat.learning, phase: "awaiting_clarification", privateAnswerKey: "An obsolete key", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-2", stepIndex: 0 } })
  assert.equal(stale.success, false)
})

test("one demonstrated criterion cannot complete a multi-criterion part, including explicit complete", async () => {
  const { session, mutations, answer, target, job } = await fixture(["Explains bounds", "Explains concurrency"])
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  assert.equal(mutations.some((mutation) => mutation.type === "complete"), false)
  const forced = await session.execute("topic_complete", target)
  assert.equal(forced.success, false)
  assert.match(forced.text, /criteria|criterion/)
  assert.equal((await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-5" })).success, true, "Navigation must allow deferring incomplete learning")
  const saved = await session.execute("save_learning_state", { ...job.chat.learning, phase: "ready_to_continue", nextAction: "Continue with 5.5", workpad: "Concurrency remains uncertain; return to it later." })
  assert.equal(saved.success, true, saved.text)
  assert.equal(session.saved, true, session.saveError ?? "Deferral must remain publishable")
  assert.ok(session.finish("We can defer concurrency and continue with 5.5.").reply)
})

test("later uncertain and contradictory reassessments reopen completion, and a genuine reassessment can complete again", async () => {
  const { session, mutations, answer, job } = await fixture()
  for (const status of ["demonstrated", "uncertain", "demonstrated", "contradicted", "demonstrated"]) {
    const result = await session.execute("topic_recordAnswer", { ...answer, assessment: { ...answer.assessment, status, remainingGap: status === "demonstrated" ? "" : "Per-job bounds remain unresolved" } })
    assert.equal(result.success, true, result.text)
    const state = structuredClone(job)
    for (const mutation of mutations) applyTopicMutation({ chats: [state.chat], scratchpads: state.scratchpads }, state.chat.id, mutation)
    const progress = TopicStateSchema.parse(state.scratchpads[0].state).threadTutors[0].progress["tp-section-2"]
    assert.equal(progress.status, status === "demonstrated" ? "completed" : "active")
    assert.equal(progress.steps[0].assessment?.status, status)
  }
  const before = mutations.length
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  assert.equal(mutations.length, before, "An identical retry must not append another answer or completion")
})

test("recovery completes saved eligible evidence without inferring completion from legacy answers", async () => {
  const { role, job, answer } = await fixture()
  const state = TopicStateSchema.parse(role.snapshot!.state)
  const progress = state.threadTutors[0].progress["tp-section-2"]
  progress.steps[0].answerFromUser = answer.answerFromUser
  progress.steps[0].assessment = { ...answer.assessment, status: "demonstrated" }
  role.snapshot!.state = state
  job.scratchpads[0].state = state
  for (const hasAssessment of [true, false]) {
    const recovered = structuredClone(role)
    const recoveredState = TopicStateSchema.parse(recovered.snapshot!.state)
    if (!hasAssessment) delete recoveredState.threadTutors[0].progress["tp-section-2"].steps[0].assessment
    recovered.snapshot!.state = recoveredState
    const operations: Parameters<typeof applyTopicMutation>[2][] = []
    const { session } = await createWorkflowRoleSession(job, recovered, async (mutation) => { operations.push(TopicMutationSchema.parse(mutation)) }, () => {})
    const next = await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-5" })
    assert.equal(next.success, true, next.text)
    assert.deepEqual(operations.map((operation) => operation.type), hasAssessment ? ["complete", "activatePart"] : ["activatePart"])
  }
})

test("a completed part starts a fresh review cycle without reusing old criterion mastery", async () => {
  const { session, answer, target, mutations } = await fixture()
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  const review = await session.execute("topic_recordQuestion", { ...target, question: "Predict the bounded input for a different document", check: {
    goalIndex: 0, criterionIndex: 0, reasoningTask: "Apply bounded ranges to another document", missingEvidence: "Learner-selected review", expectedEvidence: "Selects a bounded range",
  } })
  assert.equal(review.success, true, review.text)
  const complete = await session.execute("topic_complete", target)
  assert.equal(complete.success, false, "Old demonstrated evidence must not auto-complete a new review")
  assert.equal(mutations.filter((mutation) => mutation.type === "complete").length, 1)
})

test("direct Topic routing recovers an interrupted assessment with completion staged before the next action and no coordinator run", async (t) => {
  const { job, answer } = await fixture()
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-boundary-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  await workspace.mutate((state) => { state.chats.push(job.chat); state.scratchpads.push(...job.scratchpads) })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const path = join(directory, "checkpoints.sqlite")
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  let attempts = 0
  const native: Parameters<typeof createTutorGraph>[1] = async (input, session) => {
    attempts++
    const tools = session.tools.flatMap((tool) => tool.type === "function" ? [tool.function.name] : [])
    assert.equal(tools.includes("assume_role"), false, "Direct routing must skip the coordinator")
    assert.equal(tools.some((name) => name.startsWith("test_") || name.startsWith("generic_")), false)
    const result = await session.execute("topic_recordAnswer", answer)
    assert.equal(result.success, true, result.text)
    const staged = workflows.get(job.chat.id, turn.turnId).batches[0].jobs[0].operations
    assert.deepEqual(staged.map((operation) => operation.mutation.type), ["recordAnswer", "complete"])
    if (attempts === 1) throw new Error("Interrupted after assessment")
    assert.equal((await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-5" })).success, true)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "ready_to_continue", nextAction: "Continue 5.5", workpad: "5.2 demonstrated; current focus 5.5" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("5.2 is complete. We can continue with 5.5.")
  }
  const saver = new SqliteCheckpointSaver(path)
  await assert.rejects(createTutorGraph(workflows, native, saver, {}).invoke({ chatId: job.chat.id, turnId: turn.turnId }, config), /Interrupted after assessment/)
  saver.close()
  const resumed = new SqliteCheckpointSaver(path)
  t.after(() => resumed.close())
  await createTutorGraph(workflows, native, resumed, {}).invoke(null, config)
  const state = TopicStateSchema.parse(workspace.scratchpad(job.scratchpads[0].id).state)
  const thread = state.threadTutors[0]
  assert.equal(thread.progress["tp-section-2"].status, "completed")
  assert.equal(thread.progress["tp-section-2"].steps.length, 1)
  assert.equal(thread.currentPartId, "tp-section-5")
  assert.equal(attempts, 2, "Only the interrupted invocation should be retried")
  assert.equal(workflows.complete(job.chat.id, turn.turnId).message.content, "5.2 is complete. We can continue with 5.5.")
})

test("accumulated criteria complete together and a later reassessment of an earlier step takes precedence", async () => {
  const { session, answer, target, job, mutations } = await fixture(["Explains bounds", "Explains concurrency"])
  assert.equal((await session.execute("topic_recordAnswer", answer)).success, true)
  const second = await session.execute("topic_recordQuestion", { ...target, question: "Can bounded jobs run concurrently?", check: {
    goalIndex: 0, criterionIndex: 1, reasoningTask: "Distinguish bounds from scheduling", missingEvidence: "Independent scheduling", expectedEvidence: "Concurrent bounded jobs",
  } })
  assert.equal(second.success, true, second.text)
  const assessed = await session.execute("topic_recordAnswer", { ...answer, stepIndex: 1, assessment: { ...answer.assessment, criterionIndex: 1, evidence: [{ stepIndex: 1, quote: answer.answerFromUser }], interpretation: "The bounded input is per job, independent of scheduling" } })
  assert.equal(assessed.success, true, assessed.text)
  assert.equal(mutations.filter((mutation) => mutation.type === "complete").length, 1)
  const revision = await session.execute("topic_recordAnswer", { ...answer, assessment: { ...answer.assessment, status: "uncertain", remainingGap: "The per-job scope needs clarification" } })
  assert.equal(revision.success, true, revision.text)
  const current = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_1" })
  assert.match(current.text, /uncertain/)
  assert.equal(mutations.filter((mutation) => mutation.type === "complete").length, 1, "Later uncertainty cannot be replaced by older mastery")
  assert.equal((await session.execute("topic_complete", target)).success, false)
  assert.equal(job.scratchpads[0].state?.type, "topic")
})
