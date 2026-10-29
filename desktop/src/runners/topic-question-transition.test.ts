import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { newChat, newScratchpad, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorGraph } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"

test("completing a part then recording a question publishes without a separate activation call", async (t) => {
  for (const nextPart of ["tp-subtraction", "tp-addition"]) {
    await t.test(nextPart, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "edu-question-transition-"))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const workspace = new WorkspaceRepository(directory)
      await workspace.load()
      const runner = workspace.stateSnapshot.runners[0]
      const chat = newChat(runner.id)
      const scratchpad = newScratchpad("MIPS arithmetic")
      scratchpad.planConfirmed = true
      scratchpad.state = TopicStateSchema.parse({ ...scratchpad.state,
        content: ["addition", "subtraction"].map((name) => ({ id: `tp-${name}`, name, references: [], goals: [{ objective: "Read arithmetic instruction operands", understoodWhen: ["Identifies the instruction source operands"] }], mistakes: [] })),
        threadTutors: [{ id: chat.id, progress: { "tp-addition": { status: "active", steps: [{ question: "Which registers are added?" }] } } }],
      })
      chat.scratchpadHandles = [scratchpad.id]
      const answer = "$s1 and $s2"
      chat.messages.push({ id: randomUUID(), role: "user", content: answer, createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] })
      chat.learning = { ...chat.learning, phase: "awaiting_answer", privateAnswerKey: "$s1 and $s2", pendingQuestion: "Which registers are added?", pendingCheck: { scratchpadId: scratchpad.id, scratchpadPartId: "tp-addition", stepIndex: 0 }, nextAction: "Assess the answer", workpad: "Addition check pending." }
      await workspace.mutate((state) => { state.chats.push(chat); state.scratchpads.push(scratchpad) })
      const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [{ ...scratchpad, assetDirectory: directory }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
      const workflows = new TutorWorkflowRepository(workspace)
      const turn = await workflows.start(job)
      const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
      t.after(() => saver.close())
      const question = "What does sub $s0, $s2, $s1 compute?"
      let invocations = 0
      await createTutorGraph(workflows, async (input, session) => {
        invocations++
        const recorded = await session.execute("topic_recordAnswer", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-addition", stepIndex: 0, answerFromUser: answer, assessment: {
          goalIndex: 0, criterionIndex: 0, status: "demonstrated", evidence: [{ stepIndex: 0, quote: answer }], interpretation: "Identifies both input registers", remainingGap: "",
        } })
        assert.equal(recorded.success, true, recorded.text)
        const completed = await session.execute("topic_complete", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-addition" })
        assert.equal(completed.success, true, completed.text)
        assert.equal((await session.execute("topic_whereAmI", { scratchpadId: "scratchpad_1" })).success, true)
        assert.equal((await session.execute("topic_whatIsNext", { scratchpadId: "scratchpad_1" })).success, true)
        const recordedQuestion = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: nextPart, question, check: {
          goalIndex: 0, criterionIndex: 0, reasoningTask: "Distinguish subtraction source order", missingEvidence: "Source operand order", expectedEvidence: "$s2 minus $s1",
        } })
        assert.equal(recordedQuestion.success, true, recordedQuestion.text)
        const stepIndex = nextPart === "tp-addition" ? 1 : 0
        const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", privateAnswerKey: "$s2 - $s1", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: nextPart, stepIndex }, nextAction: "Wait for the subtraction answer", workpad: "Addition answer preserved; subtraction question recorded." })
        assert.equal(saved.success, true, saved.text)
        assert.equal(session.saved, true, session.saveError ?? "The response must be publishable")
        return session.finish("Correct. The next instruction subtracts its second source from its first.")
      }, saver, {}).invoke({ chatId: chat.id, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
      assert.equal(invocations, 1)
      const state = TopicStateSchema.parse(workspace.scratchpad(scratchpad.id).state)
      const progress = state.threadTutors[0].progress
      assert.equal(progress["tp-addition"].steps[0].answerFromUser, answer)
      assert.equal(progress[nextPart].status, "active")
      assert.equal(progress[nextPart].steps.at(-1)?.question, question)
      assert.equal(progress[nextPart].steps.length, nextPart === "tp-addition" ? 2 : 1)
      if (nextPart !== "tp-addition") assert.equal(progress["tp-addition"].status, "completed")
      const message = workflows.complete(chat.id, turn.turnId).message
      assert.match(message.content, /Correct/)
      assert.ok(message.content.includes(question))
    })
  }
})
