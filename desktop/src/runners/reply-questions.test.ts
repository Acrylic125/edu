import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { newChat } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { createTutorSession } from "./tutor"

for (const phase of ["awaiting_clarification", "awaiting_answer"] as const) {
  test(`${phase} renders with the appropriate question treatment`, async () => {
    const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
    const chat = newChat(runner.id)
    const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
    const session = await createTutorSession(job, () => {})
    let question = "Can you provide an exam or exam-preparation question set on this topic?"
    if (phase === "awaiting_answer") question = "How does progressive disclosure reduce context usage?"
    const saved = await session.execute("save_learning_state", {
      ...chat.learning, phase, question,
      privateAnswerKey: "Only the skill content needed for the current task is loaded.",
      nextAction: "Wait for the learner", workpad: "A question is pending.",
    })
    assert.equal(saved.success, true, saved.text)
    const result = session.finish("I could not verify a suitable exam-preparation source.")
    assert.equal(result.reply.includes(question), true)
    if (phase === "awaiting_clarification") assert.doesNotMatch(result.reply, /\[!CHECK\]/)
    else assert.match(result.reply, /\[!CHECK\]/)
  })
}
