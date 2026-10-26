import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newTopic } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { topicMention } from "../shared/topic-mentions"
import { createTutorSession } from "./tutor"
import { selectTutorTopicIds } from "./tutor-evidence"
import { TestStateSchema } from "../shared/scratchpad-state"
import { createWorkflowRoleSession } from "./workflow-session"
import { createWorkflowTutorSession } from "./workflow-session"
import { RoleJobSchema } from "../shared/tutor-workflow"

function evidenceJob() {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  const topic = newTopic("Fractions")
  const unrelated = newTopic("Unrelated history")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({
    ...topic.state,
    content: [
      { id: "tp-old", name: "Old part", goals: [], references: [], mistakes: [] },
      { id: "tp-current", name: "Current part", goals: [{ objective: "Understand halves", understoodWhen: ["Recognize two equal parts"] }], references: [], mistakes: [] },
      { id: "tp-untaught", name: "Untaught", goals: [], references: [], mistakes: [] },
    ],
    document: { version: 1, blocks: [
      { type: "markdown", id: "old-lesson", sectionId: "tp-old", content: ["OLD_LESSON_SENTINEL"] },
      { type: "markdown", id: "current-lesson", sectionId: "tp-current", content: ["CURRENT_LESSON_SENTINEL"] },
    ] },
    threadTutors: [
      { id: chat.id, progress: { "tp-current": { status: "active", steps: [{ question: "OLD_QUESTION_SENTINEL", answerFromUser: "OLD_ANSWER_SENTINEL" }, { question: "CURRENT_PENDING_QUESTION" }] } } },
      { id: "earlier-thread", progress: { "tp-old": { status: "completed", steps: [{ question: "HISTORICAL_QUESTION", answerFromUser: "HISTORICAL_ANSWER" }] }, "tp-untaught": { status: "active", steps: [] } } },
    ],
  })
  unrelated.archived = true
  unrelated.state = TopicStateSchema.parse({ ...topic.state, name: unrelated.title, document: { version: 1, blocks: [{ type: "markdown", id: "unrelated-lesson", sectionId: "tp-old", content: ["UNRELATED_LESSON_SENTINEL"] }] } })
  chat.topicHandles = [topic.id, unrelated.id]
  chat.learning.phase = "awaiting_answer"
  chat.learning.pendingQuestion = "CURRENT_PENDING_QUESTION"
  chat.learning.privateAnswerKey = "Two"
  chat.learning.pendingCheck = { topicId: topic.id, topicPartId: "tp-current", stepIndex: 1 }
  chat.messages.push({ id: randomUUID(), role: "user", content: `Continue ${topicMention(topic.id, topic.title)}`, createdAt: new Date().toISOString(), topicIds: [topic.id] })
  return WorkerJobSchema.parse({ runner, chat, topics: [{ ...topic, assetDirectory: "/tmp" }], workspaceTopics: [{ ...unrelated, notes: "UNRELATED_NOTES_SENTINEL" }], skillDirectory: resolve("resources/tutor-me"), assetDirectory: "/tmp" })
}

test("ordinary tutor context contains the active objective and pending check without preloading lesson history", async () => {
  const session = await createTutorSession(evidenceJob(), () => {})
  assert.match(session.instructions, /Understand halves/)
  assert.match(session.instructions, /CURRENT_PENDING_QUESTION/)
  for (const text of ["UNRELATED_LESSON_SENTINEL", "UNRELATED_NOTES_SENTINEL", "OLD_LESSON_SENTINEL", "CURRENT_LESSON_SENTINEL", "OLD_QUESTION_SENTINEL", "OLD_ANSWER_SENTINEL", "HISTORICAL_QUESTION"]) {
    assert.equal(session.instructions.includes(text), false, `History must be retrieved on demand: ${text}`)
  }
})

test("Tutor discovers other scratchpads through paginated metadata instead of preloading the workspace directory", async () => {
  const job = evidenceJob()
  const { session } = await createWorkflowTutorSession(job, [], "", () => {})
  assert.equal(session.instructions.includes("Unrelated history"), false)
  const DirectorySchema = z.object({ scratchpads: z.array(z.object({ handle: z.string(), title: z.string(), archived: z.boolean() })), nextOffset: z.number().nullable(), total: z.number() })
  const first = await session.execute("list_scratchpads", { type: "topic", limit: 1 })
  assert.equal(first.success, true, first.text)
  const page = DirectorySchema.parse(JSON.parse(first.text))
  assert.equal(page.total, 2)
  assert.equal(page.nextOffset, 1)
  assert.equal(first.text.includes("LESSON_SENTINEL"), false)
  const second = await session.execute("list_scratchpads", { query: "unrelated", includeArchived: true })
  assert.equal(DirectorySchema.parse(JSON.parse(second.text)).scratchpads[0].handle, "scratchpad_2")
  const active = await session.execute("list_scratchpads", { includeArchived: false })
  assert.equal(DirectorySchema.parse(JSON.parse(active.text)).total, 1)
})

test("turn selection prioritizes mentions and pending checks over open and historical topics", () => {
  const job = evidenceJob()
  const otherId = job.workspaceTopics[0].id
  job.openedTopicId = otherId
  assert.deepEqual(selectTutorTopicIds(job.chat, otherId), [job.topics[0].id])
  job.chat.messages.at(-1)!.content = "Two equal parts"
  job.chat.messages.at(-1)!.topicIds = [otherId]
  assert.deepEqual(selectTutorTopicIds(job.chat, otherId), [job.topics[0].id])
  job.chat.learning.pendingCheck = undefined
  assert.deepEqual(selectTutorTopicIds(job.chat, otherId), [otherId])
  assert.deepEqual(selectTutorTopicIds(job.chat, undefined, job.topics[0].id), [job.topics[0].id])
  assert.deepEqual(selectTutorTopicIds(job.chat), [otherId])
  job.chat.messages.unshift({ id: randomUUID(), role: "user", content: "Old topic", createdAt: job.chat.createdAt, topicIds: [job.topics[0].id] })
  assert.deepEqual(selectTutorTopicIds(job.chat), [otherId])
  const blank = newChat(job.runner.id)
  assert.deepEqual(selectTutorTopicIds(blank), [])
})

const CoveragePageSchema = z.object({
  topics: z.array(z.object({ topicId: z.string(), parts: z.array(z.object({ id: z.string(), coverage: z.enum(["partial", "completed"]), questionCount: z.number(), answeredCount: z.number() })) })),
  nextOffset: z.number().nullable(), totalParts: z.number(),
})

test("workspace test discovery returns paginated summaries and retains cross-thread coverage", async () => {
  const session = await createTutorSession(evidenceJob(), () => {})
  const result = await session.execute("test_getCoveredTopics", { topics: null, limit: 1 })
  assert.equal(result.success, true, result.text)
  const page = CoveragePageSchema.parse(JSON.parse(result.text))
  assert.equal(page.totalParts, 4)
  assert.equal(page.nextOffset, 1)
  assert.deepEqual(page.topics[0].parts[0], { id: "tp-old", coverage: "completed", questionCount: 1, answeredCount: 1 })
  assert.equal(result.text.includes("HISTORICAL_ANSWER"), false)
  assert.equal(result.text.includes("LESSON_SENTINEL"), false)
  const next = await session.execute("test_getCoveredTopics", { topics: ["scratchpad_1"], offset: 1, limit: 1 })
  const narrowed = CoveragePageSchema.parse(JSON.parse(next.text))
  assert.equal(narrowed.totalParts, 2)
  assert.equal(narrowed.nextOffset, null)
  assert.equal(narrowed.topics[0].parts[0].id, "tp-current")
  assert.equal(narrowed.topics[0].parts[0].coverage, "partial")
  assert.equal(narrowed.topics[0].parts[0].questionCount, 2)
  const empty = await session.execute("test_getCoveredTopics", { topics: [] })
  assert.equal(CoveragePageSchema.parse(JSON.parse(empty.text)).totalParts, 0)
})

test("section evidence can be read in bounded pages across threads without expanding the initial prompt", async () => {
  const session = await createTutorSession(evidenceJob(), () => {})
  const PageSchema = z.object({ evidence: z.string(), nextOffset: z.number().nullable(), totalCharacters: z.number() })
  const chunks = []
  let offset = 0
  while (true) {
    const result = await session.execute("read_topic_evidence", { topicId: "scratchpad_1", topicPartId: "tp-old", offset, limit: 80 })
    assert.equal(result.success, true, result.text)
    const page = PageSchema.parse(JSON.parse(result.text))
    assert.ok(page.evidence.length <= 80)
    chunks.push(page.evidence)
    if (page.nextOffset === null) break
    offset = page.nextOffset
  }
  const evidence = chunks.join("")
  assert.match(evidence, /HISTORICAL_QUESTION/)
  assert.match(evidence, /HISTORICAL_ANSWER/)
  assert.match(evidence, /OLD_LESSON_SENTINEL/)
  assert.equal(evidence.includes("CURRENT_PENDING_QUESTION"), false)
  const unrelated = await session.execute("read_topic_evidence", { topicId: "scratchpad_2", topicPartId: "tp-old" })
  assert.equal(unrelated.success, true, unrelated.text)
  assert.match(unrelated.text, /UNRELATED_LESSON_SENTINEL/)
  const missing = await session.execute("read_topic_evidence", { topicId: "scratchpad_1", topicPartId: "tp-missing" })
  assert.equal(missing.success, false)
})

test("an existing test discovers only its saved source scope unless an explicit scope is supplied", async () => {
  const job = evidenceJob()
  const source = job.topics[0]
  const assessment = newTopic("Fractions test", "test")
  assessment.state = TestStateSchema.parse({ ...assessment.state, references: [{ type: "topic", id: source.id }] })
  job.workspaceTopics.push({ ...source, notes: source.learning.notes })
  job.topics = [{ ...assessment, assetDirectory: "/tmp" }]
  job.chat.topicHandles.push(assessment.id)
  job.chat.learning = newChat(job.runner.id).learning
  job.chat.messages.at(-1)!.content = `Continue ${topicMention(assessment.id, assessment.title)}`
  job.chat.messages.at(-1)!.topicIds = [assessment.id]
  const session = await createTutorSession(job, () => {})
  assert.equal(session.instructions.includes("CURRENT_LESSON_SENTINEL"), false)
  const page = await session.execute("test_getCoveredTopics", { topics: null })
  const inventory = CoveragePageSchema.parse(JSON.parse(page.text))
  assert.equal(inventory.totalParts, 2)
  assert.deepEqual(inventory.topics.map((topic) => topic.topicId), ["scratchpad_1"])
  const expanded = await session.execute("test_getCoveredTopics", { topics: ["scratchpad_2"] })
  assert.deepEqual(CoveragePageSchema.parse(JSON.parse(expanded.text)).topics.map((topic) => topic.topicId), ["scratchpad_2"])
})

test("a test role discovers granted historical topics without receiving their full history in its prompt", async () => {
  const job = evidenceJob()
  const source = job.topics[0]
  const testId = randomUUID()
  job.chat.topicHandles.push(testId)
  const role = RoleJobSchema.parse({
    jobId: randomUUID(), stageId: randomUUID(), scratchpadId: testId, scratchpadHandle: "scratchpad_3", role: "test", access: "write", mode: "create", snapshot: null, baseVersion: null, operations: [], dependencies: [source],
    request: { target: { mode: "create", type: "test" }, task: "Test the covered material", requestedAccess: "write", context: { learnerMessageIds: [job.chat.messages[0].id], materialIds: [], readDependencies: ["scratchpad_1"], relevantContext: "Use the agreed source scope" } },
  })
  const { session } = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  assert.equal(session.instructions.includes("HISTORICAL_ANSWER"), false)
  const inventory = await session.execute("test_getCoveredTopics", { topics: null })
  assert.equal(inventory.success, true, inventory.text)
  assert.equal(CoveragePageSchema.parse(JSON.parse(inventory.text)).totalParts, 2)
  const detail = await session.execute("read_topic_evidence", { topicId: "scratchpad_1", topicPartId: "tp-old" })
  assert.equal(detail.success, true, detail.text)
  assert.match(detail.text, /HISTORICAL_ANSWER/)
  const denied = await session.execute("read_topic_evidence", { topicId: "scratchpad_2", topicPartId: "tp-old" })
  assert.equal(denied.success, false)
})
