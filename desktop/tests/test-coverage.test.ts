import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { WorkerJobSchema } from "../src/shared/contracts"
import { isScratchpadReadTool } from "../src/runners/scratchpad-tools"
import { TopicStateSchema } from "../src/shared/topic-state"
import { createTutorSession } from "../src/runners/tutor"

function job() {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex" as const, model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Number systems")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({
    ...topic.state,
    content: ["old", "recent", "future", "activated"].map((name) => ({ id: `tp-${name}`, name, goals: [], mistakes: [], references: [] })),
    threadTutors: [
      { id: "earlier-thread", progress: { "tp-old": { status: "completed", steps: [] } } },
      { id: "latest-thread", progress: {
        "tp-recent": { status: "active", steps: [{ question: "Convert a binary integer." }] },
        "tp-activated": { status: "active", steps: [] },
      } },
    ],
  })
  return { runner, chat, topics: [], workspaceTopics: [{ ...topic, notes: "", assetDirectory: resolve("tests") }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"), apiKey: "" }
}

test("test coverage includes earlier teaching across threads and excludes untouched curriculum", async () => {
  const session = await createTutorSession(job(), () => {})
  const result = await session.execute("test_getCoveredTopics", { topics: null })
  expect(result.success).toBe(true)
  const coverage = JSON.parse(result.text)
  expect(coverage).toHaveLength(1)
  expect(coverage[0]).toMatchObject({ topicId: "scratchpad_1", parts: [
    { id: "tp-old", coverage: "completed" },
    { id: "tp-recent", coverage: "partial", steps: [{ question: "Convert a binary integer." }] },
  ] })
  expect(coverage[0].parts).toHaveLength(2)
  expect(result.text).not.toContain("tp-future")
  expect(result.text).not.toContain("tp-activated")
  expect(session.instructions).toContain(`Covered topic evidence: ${result.text}`)
})

test("test coverage honors an explicit scope and includes taught content before a check", async () => {
  const input = job()
  const topic = input.workspaceTopics[0]
  topic.state = TopicStateSchema.parse({ ...topic.state, document: { version: 1, blocks: [
    { id: "lesson", type: "markdown", sectionId: "tp-activated", content: ["A binary place has a power-of-two weight."] },
  ] } })
  const session = await createTutorSession(input, () => {})
  const excluded = await session.execute("test_getCoveredTopics", { topics: [] })
  expect(excluded).toMatchObject({ success: true, text: "[]" })
  const included = await session.execute("test_getCoveredTopics", { topics: ["scratchpad_1"] })
  expect(included.success).toBe(true)
  expect(JSON.parse(included.text)[0].parts).toContainEqual(expect.objectContaining({ id: "tp-activated", coverage: "partial", taughtContent: ["A binary place has a power-of-two weight."] }))
})


test("coverage refreshes after teaching and exposes topic references as session handles", async () => {
  const input = WorkerJobSchema.parse(job())
  const topic = input.workspaceTopics[0]
  const state = TopicStateSchema.parse(topic.state)
  state.content[0].references = [{ type: "topic", id: topic.id }]
  input.topics.push({ ...newTopic(topic.title), id: topic.id, state, planConfirmed: true, assetDirectory: input.assetDirectory })
  const session = await createTutorSession(input, () => {})
  expect(isScratchpadReadTool("test_getCoveredTopics")).toBe(true)
  const initial = await session.execute("test_getCoveredTopics", { topics: null })
  expect(initial.text).not.toContain(topic.id)
  expect(JSON.parse(initial.text)[0].parts[0].references).toEqual([{ type: "topic", id: "scratchpad_1" }])
  expect((await session.execute("topic_activatePart", { topicId: "scratchpad_1", topicPartId: "tp-future" })).success).toBe(true)
  expect((await session.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-future", question: "What does this newly introduced concept mean?" })).success).toBe(true)
  const refreshed = await session.execute("test_getCoveredTopics", { topics: ["scratchpad_1"] })
  expect(refreshed.success).toBe(true)
  expect(JSON.parse(refreshed.text)[0].parts).toContainEqual(expect.objectContaining({ id: "tp-future", coverage: "partial" }))
})
