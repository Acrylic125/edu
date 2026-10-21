import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { GenericStateSchema, TestStateSchema } from "../src/shared/scratchpad-state"
import { createTutorSession } from "../src/runners/tutor"

function job() {
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex" as const, model: "test" }
  const topic = newTopic("Limits")
  topic.planConfirmed = true
  const test = newTopic("Test")
  test.state = TestStateSchema.parse({ type: "test", version: "19-10-2026", createdAt: test.createdAt, name: test.title, goals: [], questions: [], content: [], references: [] })
  const generic = newTopic("Notes")
  generic.state = GenericStateSchema.parse({ type: "generic", version: "19-10-2026", createdAt: generic.createdAt, name: generic.title, references: [] })
  return { runner, chat: newChat(runner.id), topics: [topic, test, generic].map((item) => ({ ...item, assetDirectory: resolve("tests") })), workspaceTopics: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"), apiKey: "" }
}

test("one session reads multiple scratchpad roles and rejects cross-role tools", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  for (const [index, role] of ["topic", "test", "generic"].entries()) {
    const result = await session.execute("read_scratchpad", { scratchpadId: `scratchpad_${index + 1}` })
    expect(result.success).toBe(true)
    expect(JSON.parse(result.text)).toMatchObject({ type: role, state: { type: role } })
  }
  expect((await session.execute("topic_whereAmI", { topicId: "scratchpad_1" })).success).toBe(true)
  expect((await session.execute("test_whereAmI", { testId: "scratchpad_2" })).success).toBe(true)
  expect((await session.execute("generic_getReferences", { genericId: "scratchpad_3" })).success).toBe(true)
  for (const [name, argumentsObject] of [
    ["topic_whereAmI", { topicId: "scratchpad_2" }],
    ["test_getQuestions", { testId: "scratchpad_3" }],
    ["generic_addReference", { genericId: "scratchpad_1", reference: { type: "website", url: "https://example.com" } }],
    ["whereAmI", { topicId: "scratchpad_1" }],
    ["test_whereAmI", { testId: input.topics[1].id }],
  ] as const) expect((await session.execute(name, argumentsObject)).success).toBe(false)
})

test("bundled skills are byte-for-byte identical and the session uses role skills", async () => {
  const session = await createTutorSession(job(), () => {})
  for (const name of ["MANAGE_TOPIC.md", "MANAGE_TEST.md", "MANAGE_GENERIC.md", "FEEDBACK_AND_DELIBERATE.md", "WHAT_IS_UNDERSTANDING.md", "WRITING_STYLE.md", "UNSLOP.md"]) {
    const supplied = await readFile(resolve("../docs/refactor_plan/skills", name), "utf8")
    expect(await readFile(resolve("resources/tutor-me/skills", name), "utf8")).toBe(supplied)
  }
  expect(session.instructions).toContain("# Manage Topic")
  expect(session.instructions).toContain("# Manage Test")
  expect(session.instructions).toContain("# Manage Generic")
  expect(session.instructions).not.toContain("new-curriculum workflow")
})

test("test and generic writes can be staged together without topic-plan gating", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const question = { title: "A limit", question: "What is approached?", reference: [], goals: [], mistakes: [] }
  expect((await session.execute("test_addQuestion", { testId: "scratchpad_2", question })).success).toBe(true)
  expect((await session.execute("test_recordAnswer", { testId: "scratchpad_2", title: question.title, answer: "3" })).success).toBe(true)
  expect((await session.execute("generic_updateScratchpad", { genericId: "scratchpad_3", summary: "# Notes\n\nFree notes." })).success).toBe(true)
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
  const result = session.finish("Saved both scratchpads.")
  expect(result.topicMutations.map((mutation) => mutation.type)).toEqual(["addTestQuestion", "recordTestAnswer", "updateGeneric"])
  expect(JSON.parse((await session.execute("read_scratchpad", { scratchpadId: "scratchpad_2" })).text).notes).toContain("### You answered\n3")
  expect(JSON.parse((await session.execute("read_scratchpad", { scratchpadId: "scratchpad_3" })).text).notes).toBe("# Notes\n\nFree notes.")
})

test("new test and generic handles immediately enforce their roles", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const created = await session.execute("test_createTest", { test: { type: "test", version: "19-10-2026", name: "New test", questions: [], goals: [], content: [], references: [] } })
  expect(created.success).toBe(true)
  expect(JSON.parse(created.text)).toMatchObject({ type: "test", scratchpadId: "scratchpad_4" })
  expect((await session.execute("test_getQuestions", { testId: "scratchpad_4" })).success).toBe(true)
  const generic = await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "New notes", references: [] } })
  expect(generic.success).toBe(true)
  expect((await session.execute("generic_getReferences", { genericId: "scratchpad_5" })).success).toBe(true)
  expect((await session.execute("topic_whereAmI", { topicId: "scratchpad_5" })).success).toBe(false)
})

test("archived scratchpad references can be read but role writers cannot mutate them", async () => {
  const input = job()
  const archived = input.topics.pop()!
  const session = await createTutorSession({ ...input, workspaceTopics: [{ id: archived.id, title: archived.title, archived: true, state: archived.state, notes: "Archived notes" }] }, () => {})
  expect((await session.execute("generic_getReferences", { genericId: "scratchpad_3" })).success).toBe(true)
  const denied = await session.execute("generic_updateScratchpad", { genericId: "scratchpad_3", summary: "Overwrite" })
  expect(denied.success).toBe(false)
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
  expect(session.saved).toBe(false)
})

test("structured topic references use scratchpad handles at the model boundary", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const result = await session.execute("generic_addReference", { genericId: "scratchpad_3", reference: { type: "topic", id: "scratchpad_1" } })
  expect(result.success).toBe(true)
  const read = await session.execute("generic_getReferences", { genericId: "scratchpad_3" })
  expect(JSON.parse(read.text)).toEqual([{ type: "topic", id: "scratchpad_1" }])
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.finish("Linked the topic.").topicMutations).toMatchObject([{ type: "addGenericReference", reference: { type: "topic", id: input.topics[0].id } }])
})

test("archiving a previously tagged scratchpad revokes its write capabilities", async () => {
  const input = job()
  input.topics[2].archived = true
  const session = await createTutorSession(input, () => {})
  expect((await session.execute("generic_getReferences", { genericId: "scratchpad_3" })).success).toBe(true)
  expect((await session.execute("generic_updateScratchpad", { genericId: "scratchpad_3", summary: "Overwrite archived notes" })).success).toBe(false)
})

test("a new scratchpad request reaches the tutor without a predetermined type", async () => {
  const input = job()
  input.chat.scratchpadRequested = true
  input.topics = []
  const session = await createTutorSession(input, () => {})
  expect(session.instructions).toContain("Infer the scratchpad type from the learner's request and chat context")
  expect(session.instructions).toContain("Scratchpad creation requested: true")
  const premature = await session.execute("save_learning_state", input.chat.learning)
  expect(premature.success).toBe(false)
  expect(session.saved).toBe(false)
  const created = await session.execute("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Reading notes", references: [] } })
  expect(created.success).toBe(true)
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
  expect(session.finish("Created your notes.").topicMutations).toMatchObject([{ type: "createGeneric" }])
})

test("the tutor can clarify an ambiguous scratchpad request without precreating a topic", async () => {
  const input = job()
  input.chat.scratchpadRequested = true
  input.topics = []
  const session = await createTutorSession(input, () => {})
  expect((await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_choice", nextAction: "Wait for the learner's goal." })).success).toBe(true)
  expect(session.finish("What would you like to work on?").topicMutations).toEqual([])
})

test("repeated creation calls for one request return the original scratchpad handle", async () => {
  const input = job()
  input.topics = []
  input.chat.messages.push({ id: randomUUID(), role: "user", content: "Teach me limits", createdAt: new Date().toISOString(), topicIds: [] })
  const session = await createTutorSession(input, () => {})
  const payload = { topic: { type: "topic", version: "11-10-2026", name: "Learn Calculus", content: [] } }
  const first = await session.execute("topic_createTopic", payload)
  const retry = await session.execute("topic_createTopic", payload)
  expect(first.success).toBe(true)
  expect(retry.success).toBe(true)
  expect(JSON.parse(retry.text).scratchpadId).toBe(JSON.parse(first.text).scratchpadId)
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.finish("Here is the plan.").topicMutations.filter((mutation) => mutation.type === "createTopic")).toHaveLength(1)
})

test("creating an already tagged topic reuses it instead of creating a second copy", async () => {
  const input = job()
  input.chat.messages.push({ id: randomUUID(), role: "user", content: "Teach me limits", createdAt: new Date().toISOString(), topicIds: [input.topics[0].id] })
  const session = await createTutorSession(input, () => {})
  const created = await session.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: input.topics[0].title, content: [] } })
  expect(created.success).toBe(true)
  expect(JSON.parse(created.text).scratchpadId).toBe("scratchpad_1")
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.finish("Use this topic.").topicMutations.filter((mutation) => mutation.type === "createTopic")).toHaveLength(0)
})

for (const type of ["test", "generic"] as const) {
  test(`${type} creation retries reuse one document within the request`, async () => {
    const input = job()
    input.topics = []
    input.chat.messages.push({ id: randomUUID(), role: "user", content: "Create a review scratchpad", createdAt: new Date().toISOString(), topicIds: [] })
    const session = await createTutorSession(input, () => {})
    let name = "generic_createGeneric"
    let payload: Parameters<typeof session.execute>[1] = { generic: { type: "generic", version: "19-10-2026", name: "Review", references: [] } }
    if (type === "test") {
      name = "test_createTest"
      payload = { test: { type, version: "19-10-2026", name: "Review", references: [], goals: [], content: [], questions: [] } }
    }
    const first = await session.execute(name, payload)
    const retry = await session.execute(name, payload)
    expect(first.success).toBe(true)
    expect(retry.success).toBe(true)
    expect(JSON.parse(retry.text).scratchpadId).toBe(JSON.parse(first.text).scratchpadId)
    await session.execute("save_learning_state", input.chat.learning)
    expect(session.finish("Created your scratchpad.").topicMutations).toHaveLength(1)
  })
}

test.each(["topic", "test", "generic"])("a leading /new-%s explicitly selects the creation role in an existing chat", async (type) => {
  const input = job()
  input.chat.messages.push({ id: randomUUID(), role: "user", content: `/new-${type} Work on limits`, createdAt: new Date().toISOString(), topicIds: [] })
  const session = await createTutorSession(input, () => {})
  expect(session.instructions).toContain(`Explicit creation command this turn: /new-${type}; create a ${type} scratchpad`)
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(false)
  const payloads = [
    { role: "topic", name: "topic_createTopic", input: { topic: { type: "topic", version: "11-10-2026", name: "Limits", content: [] } } },
    { role: "test", name: "test_createTest", input: { test: { type: "test", version: "19-10-2026", name: "Practice", goals: [], questions: [], content: [], references: [] } } },
    { role: "generic", name: "generic_createGeneric", input: { generic: { type: "generic", version: "19-10-2026", name: "Notes", references: [] } } },
  ]
  for (const payload of payloads.filter((payload) => payload.role !== type)) {
    expect((await session.execute(payload.name, payload.input)).success).toBe(false)
  }
  const payload = payloads.find((payload) => payload.role === type)!
  expect((await session.execute(payload.name, payload.input)).success).toBe(true)
  if (type !== "topic") {
    expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
    expect(session.saved).toBe(true)
  }
})

test.each(["Please /new-test limits", " /new-test limits"])("non-leading commands do not select a role: %s", async (content) => {
  const input = job()
  input.chat.messages.push({ id: randomUUID(), role: "user", content, createdAt: new Date().toISOString(), topicIds: [] })
  const session = await createTutorSession(input, () => {})
  expect(session.instructions).toContain("Explicit creation command this turn: none; infer type")
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
})
