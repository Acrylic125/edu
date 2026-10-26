import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newTopic } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { RoleJobSchema } from "../shared/tutor-workflow"
import { TopicStateSchema } from "../shared/topic-state"
import { createWorkflowRoleSession } from "./workflow-session"

test("the teaching role receives saved terminology and instructions to fill gaps in existing lessons", async () => {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Vector spaces")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({
    ...topic.state,
    content: [{ id: "tp-spaces", name: "Vector spaces", references: [], goals: [], mistakes: [] }],
    document: { version: 1, blocks: [
      { type: "markdown", id: "lesson", sectionId: "tp-spaces", content: ["A vector space is a set with vector addition and scalar multiplication."] },
      { type: "term", id: "term-vector-space", term: "vector space", meaning: "A set with addition and scalar multiplication satisfying the vector space axioms." },
    ] },
  })
  chat.topicHandles = [topic.id]
  const job = WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
  const role = RoleJobSchema.parse({
    jobId: randomUUID(), stageId: randomUUID(), scratchpadId: topic.id, scratchpadHandle: "scratchpad_1",
    role: "topic", access: "write", mode: "existing", snapshot: topic, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Continue teaching", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } },
  })
  const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  const currentTarget = z.object({ terminology: z.array(z.object({ id: z.string(), term: z.string() })) })
    .parse(JSON.parse(session.instructions.split("Current target: ")[1].split("\n")[0]))
  assert.deepEqual(currentTarget.terminology, [{ id: "term-vector-space", term: "vector space" }])
  assert.match(session.instructions, /same `topic_editContent` call/)
  assert.match(session.instructions, /backfill missing terms/)

  const edit = await session.execute("topic_editContent", {
    topicId: "scratchpad_1",
    changes: [{ action: "add", block: { type: "term", id: "term-scalar", term: "scalar multiplication", meaning: "Multiplying a vector by a number to obtain another vector." } }],
  })
  assert.equal(edit.success, true, edit.text)
  const saved = await session.execute("read_scratchpad", { scratchpadId: "scratchpad_1", offset: 0, limit: 20_000 })
  assert.equal(saved.success, true, saved.text)
  assert.match(saved.text, /scalar multiplication/)
  assert.match(saved.text, /Multiplying a vector by a number/)
})
