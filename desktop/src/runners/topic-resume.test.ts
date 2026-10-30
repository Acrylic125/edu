import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newScratchpad, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"
import { createTutorSession } from "./tutor"

test("a new chat registers a resumed check before displaying it and records the answer in its own progress", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-resume-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const original = newChat(runner.id)
  const chat = newChat(runner.id)
  const scratchpad = newScratchpad("Structure-aware chunks")
  scratchpad.planConfirmed = true
  const question = "Without Model A's heading, what mistake might an agent make when answering about Model B's load limit?"
  const check = { goalIndex: 0, criterionIndex: 0, reasoningTask: "Infer a misattribution caused by lost heading context", missingEvidence: "The consequence of detaching a table value from its equipment heading", expectedEvidence: "The agent could report Model A's limit as Model B's limit" }
  scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state,
    content: [{ id: "tp-context", name: "Heading context", references: [], mistakes: [], goals: [{ objective: "Connect structure-aware chunks to reliable retrieval", understoodWhen: ["Explains how losing a heading changes attribution"] }] }],
    threadTutors: [{ id: original.id, progress: { "tp-context": { status: "active", steps: [
      ...Array.from({ length: 16 }, (_, index) => ({ question: `Earlier check ${index}`, answerFromUser: `Earlier answer ${index}` })),
      { question, check },
    ] } } }],
  })
  chat.scratchpadHandles = [scratchpad.id]
  chat.messages.push({ id: randomUUID(), role: "user", content: "Continue from where we last left off", createdAt: chat.createdAt, scratchpadIds: [scratchpad.id] })
  await workspace.mutate((state) => { state.chats.push(original, chat); state.scratchpads.push(scratchpad) })
  const workflows = new TutorWorkflowRepository(workspace)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  const firstJob = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const first = await workflows.start(firstJob)
  await createTutorGraph(workflows, async (input, session) => {
    const unbound = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", question, privateAnswerKey: "The value could be attributed to Model B", nextAction: "Wait for the answer", workpad: "Continue the check from the earlier chat" })
    assert.equal(unbound.success, false, "A Topic check cannot be published without a current-thread question")
    assert.match(unbound.text, /current thread|resumeFrom/i)
    const mismatch = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", question: "A different invented question", resumeFrom: { threadId: original.id, stepIndex: 16 } })
    assert.equal(mismatch.success, false, "A source reference cannot be paired with a different question")
    const resumed = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", question, resumeFrom: { threadId: original.id, stepIndex: 16 } })
    assert.equal(resumed.success, true, resumed.text)
    const reference = z.object({ pendingCheck: z.object({ scratchpadId: z.string(), scratchpadPartId: z.string(), stepIndex: z.number() }) }).parse(JSON.parse(resumed.text)).pendingCheck
    assert.equal(reference.stepIndex, 0, "The source index must not become the destination index")
    assert.equal((await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", question, resumeFrom: { threadId: original.id, stepIndex: 16 } })).success, true, "Resume retries must not create extra questions")
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", pendingCheck: reference, privateAnswerKey: "The value could be attributed to Model B", nextAction: "Wait for the answer to the resumed check", workpad: "The current thread owns the resumed check at step 0" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("The invented row belongs to Model A. Consider the effect of losing that heading.")
  }, saver, {}).invoke({ chatId: chat.id, turnId: first.turnId }, { configurable: { thread_id: first.turnId }, durability: "sync" })
  assert.ok(workflows.complete(chat.id, first.turnId).message.content.includes(question))
  const answer = "It will think forklift B has a max load of 500kg"
  await workspace.mutate((state) => {
    state.chats.find((entry) => entry.id === chat.id)!.messages.push({ id: randomUUID(), role: "user", content: answer, createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] })
  })
  const secondJob = WorkerJobSchema.parse({ ...firstJob, chat: workspace.stateSnapshot.chats.find((entry) => entry.id === chat.id), scratchpads: [{ ...workspace.scratchpad(scratchpad.id), assetDirectory: directory }] })
  const second = await workflows.start(secondJob)
  await createTutorGraph(workflows, async (input, session) => {
    const own = await session.execute("topic_getQuestions", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", threadId: chat.id })
    assert.equal(z.array(z.object({ threadId: z.string(), stepIndex: z.number() })).parse(JSON.parse(own.text)).length, 1, "An explicit current-thread query must exclude foreign indexes")
    const pending = input.chat.learning.pendingCheck
    assert.equal(pending?.stepIndex, 0)
    const recorded = await session.execute("topic_recordAnswer", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", stepIndex: 0, answerFromUser: answer, assessment: {
      goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }], interpretation: "The learner identifies the misattribution to Model B", remainingGap: "",
    } })
    assert.equal(recorded.success, true, recorded.text)
    assert.equal((await session.execute("topic_complete", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context" })).success, true)
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_choice", pendingCheck: undefined, question: "The walkthrough is complete. Review or quick practice?", responseOptions: ["Review", "Quick practice"], nextAction: "Wait for the review or practice choice", workpad: "The resumed check is demonstrated; the planned material is covered" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("Correct: without its heading, Model A's limit could be misattributed to Model B. That completes the walkthrough.")
  }, saver, {}).invoke({ chatId: chat.id, turnId: second.turnId }, { configurable: { thread_id: second.turnId }, durability: "sync" })
  const completed = workflows.complete(chat.id, second.turnId).message
  assert.deepEqual(completed.responseQuestion?.options, ["Review", "Quick practice"])
  const state = TopicStateSchema.parse(workspace.scratchpad(scratchpad.id).state)
  const originalSteps = state.threadTutors.find((thread) => thread.id === original.id)!.progress["tp-context"].steps
  const progress = state.threadTutors.find((thread) => thread.id === chat.id)!.progress["tp-context"]
  assert.equal(originalSteps.length, 17)
  assert.equal(originalSteps[16].answerFromUser, undefined, "The source thread's history remains unchanged")
  assert.equal(progress.steps.length, 1)
  assert.equal(progress.steps[0].answerFromUser, answer)
  assert.deepEqual(progress.steps[0].check, check)
  assert.deepEqual(progress.steps[0].resumeFrom, { threadId: original.id, stepIndex: 16 })
  assert.equal(progress.status, "completed")
  const third = newChat(runner.id)
  third.scratchpadHandles = [scratchpad.id]
  third.messages.push({ id: randomUUID(), role: "user", content: "Continue", createdAt: third.createdAt, scratchpadIds: [scratchpad.id] })
  const session = await createTutorSession(WorkerJobSchema.parse({ ...firstJob, chat: third, scratchpads: [{ ...workspace.scratchpad(scratchpad.id), assetDirectory: directory }] }), () => {})
  const resolved = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-context", question, resumeFrom: { threadId: original.id, stepIndex: 16 } })
  assert.equal(resolved.success, false, "The original unanswered record must not restart a check demonstrated by its continuation")
  assert.match(resolved.text, /already been demonstrated/)
})
