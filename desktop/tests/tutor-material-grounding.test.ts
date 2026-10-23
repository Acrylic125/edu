import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"
import { StateService } from "../src/main/state-service"
import { WorkerJobSchema } from "../src/shared/contracts"
import { TopicStateSchema } from "../src/shared/topic-state"
import { createTutorSession } from "../src/runners/tutor"
import { runTutorLoop } from "../src/runners/tutor-loop"

function job() {
  const chat = newChat(randomUUID())
  chat.materials.push({ id: randomUUID(), name: "Lecture 3A.pdf", kind: "pdf", text: "Positional notation\nBinary fractions", pages: ["Positional notation", "Binary fractions"] })
  return WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" }, skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests") })
}

const part = {
  id: "tp-binary", name: "Binary fractions", goals: [], mistakes: [],
  references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 1, to: 2 }] }],
}

test("an empty topic cannot bypass attached-source planning", async () => {
  const input = job()
  const tutor = await createTutorSession(input, () => {})
  const result = await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [] } })
  expect(result.success).toBe(false)
  expect(result.text).toContain("attached")
})

test("planning cannot silently ignore a second attached file", async () => {
  const input = job()
  input.chat.materials.push({ id: randomUUID(), name: "Tutorial.txt", kind: "text", text: "Practice converting binary fractions.", pages: [] })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  const payload = { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [part] } }
  const ignored = await tutor.execute("topic_createTopic", payload)
  expect(ignored.success).toBe(false)
  expect(ignored.text).toContain("Tutorial.txt")
  await tutor.execute("read_material", { id: input.chat.materials[1].id, firstPage: 1, lastPage: 1 })
  expect((await tutor.execute("topic_createTopic", payload)).success).toBe(true)
})

test("planning cannot treat the first excerpt as the end of a slide deck", async () => {
  const input = job()
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 1 })
  const payload = { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [{ ...part, references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 1, to: 1 }] }] }] } }
  const truncated = await tutor.execute("topic_createTopic", payload)
  expect(truncated.success).toBe(false)
  expect(truncated.text).toContain("page 2")
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 2, lastPage: 2 })
  expect((await tutor.execute("topic_createTopic", payload)).success).toBe(true)
})

test("inferred source headings guide the tutor without rejecting structurally valid curricula", async () => {
  const input = job()
  const material = input.chat.materials[0]
  material.pages = ["1. Data Representation\n2. Decimal Number System\n3. Other Number Systems", "1. Data Representation (1/2)\nThe same bits can mean different things.", "1. Data Representation (2/2)\nN bits encode 2^N values.", "2. Decimal Number System\n7594.36 expands by powers of ten.\n13.25 × 2 = 26.5", "3. Other Number Systems\nBinary, octal and hexadecimal.\n101.01 = 5.25", "13.25 × 2 = 26.5"]
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: material.id, firstPage: 1, lastPage: 6 })
  const create = (content: Parameters<typeof tutor.execute>[1]) => tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content } })
  const sourcePart = (id: string, name: string, from: number, to: number) => ({ ...part, id, name, references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from, to }] }] })
  const dropped = await create([sourcePart("tp-data", "Data Representation", 2, 3)])
  expect(dropped.success).toBe(true)
  const merged = await create([sourcePart("tp-all", "Bits and bases", 2, 6)])
  expect(merged.success).toBe(true)
  expect((await create([sourcePart("tp-data", "Data Representation", 2, 3), sourcePart("tp-decimal", "Decimal Number System", 4, 4), sourcePart("tp-other", "Other Number Systems", 5, 6)])).success).toBe(true)
  const replacement = await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [sourcePart("tp-data", "Data Representation", 2, 3)] })
  expect(replacement.success).toBe(true)
})

test("inferred continuation pages do not impose text-derived save boundaries", async () => {
  const input = job()
  const material = input.chat.materials[0]
  material.pages = ["1. Data Representation\nTypes determine interpretation.", "2. Signed Integers\nFixed-width signed values.", "Past-Year's Exam Question\nint n = 2147483640;\nfor (int i = 1; i <= 10; i++) n++;", "Quiz\nPlease complete the quiz in Canvas.", "End of File"]
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: material.id, firstPage: 1, lastPage: 5 })
  const data = { ...part, id: "tp-data", name: "Data Representation", references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 1, to: 1 }] }] }
  const signed = { ...part, name: "Signed Integers", references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 2, to: 2 }] }] }
  const create = (content: Parameters<typeof tutor.execute>[1]) => tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content } })
  const omitted = await create([data, signed])
  expect(omitted.success).toBe(true)
  signed.references[0].pages[0].to = 3
  expect((await create([data, signed])).success).toBe(true)
})

test("explicit parent references define hierarchy independently of heading punctuation", async () => {
  const input = job()
  const material = input.chat.materials[0]
  material.pages = ["5. R-Format\nInstruction encoding", "5.1 R-Format: Example\nWorked example", "5.1.1 Encoding fields\nField widths", "6. I-Format\nImmediate encoding"]
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: material.id, firstPage: 1, lastPage: 4 })
  const sourcePart = (id: string, name: string, page: number) => ({ ...part, id, name, references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: page, to: page }] }] })
  const root = sourcePart("tp-r", "5. R-Format", 1)
  const child = sourcePart("tp-example", "5.1 R-Format: Example", 2)
  const grandchild = sourcePart("tp-fields", "5.1.1 Encoding fields", 3)
  const sibling = sourcePart("tp-i", "6. I-Format", 4)
  const create = (content: Parameters<typeof tutor.execute>[1]) => tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "MIPS", content } })
  const flat = await create([root, child, grandchild, sibling])
  expect(flat.success).toBe(true)
  const wrongParent = await create([root, { ...child, parent: sibling }, { ...grandchild, parent: child }, sibling])
  expect(wrongParent.success).toBe(true)
  const nested = await create([root, { ...child, parent: root }, { ...grandchild, parent: child }, sibling])
  expect(nested.success).toBe(true)
})

test("topic publication preserves every supplied file in its own assets folder even before citation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-grounding-"))
  try {
    const repository = new WorkspaceRepository(directory)
    await repository.load()
    const input = job()
    input.chat.runnerId = repository.stateSnapshot.runners[0].id
    input.chat.materials.push({ id: randomUUID(), name: "Tutorial.txt", kind: "text", text: "Practice converting binary fractions.", pages: [] })
    const assets = join(directory, "chats", input.chat.id, "assets")
    await mkdir(assets, { recursive: true })
    for (const material of input.chat.materials) await writeFile(join(assets, material.name), material.text)
    await repository.mutate((state) => state.chats.push(input.chat))
    const tutor = await createTutorSession(input, () => {})
    for (const material of input.chat.materials) {
      expect((await tutor.execute("read_material", { id: material.id, firstPage: 1, lastPage: material.pages.length || 1 })).success).toBe(true)
    }
    expect((await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [part] } })).success).toBe(true)
    await tutor.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_plan_confirmation" })
    const service = new StateService(repository, input.chat.id)
    for (const mutation of tutor.finish("The plan follows the lecture; the tutorial is available for practice.").topicMutations) await service.write(mutation)
    const topic = repository.stateSnapshot.topics[0]
    expect(topic.materials.map((material) => material.name).sort()).toEqual(["Lecture 3A.pdf", "Tutorial.txt"])
    for (const material of input.chat.materials) {
      expect(await readFile(join(directory, "scratchpads", topic.id, "assets", material.name), "utf8")).toBe(material.text)
    }
    await rm(join(directory, "chats", input.chat.id), { recursive: true })
    const reloaded = new WorkspaceRepository(directory)
    await reloaded.load()
    expect(reloaded.topic(topic.id).materials).toHaveLength(2)
    expect(await readFile(join(directory, "scratchpads", topic.id, "assets", "Tutorial.txt"), "utf8")).toBe("Practice converting binary fractions.")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("attached lectures cannot be replaced with website-only curriculum parts", async () => {
  const input = job()
  const tutor = await createTutorSession(input, () => {})
  const result = await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [{ ...part, references: [{ type: "website", url: "https://example.com/binary" }] }] } })
  expect(result.success).toBe(false)
  expect(result.text).toContain("attached")
  await tutor.execute("save_learning_state", input.chat.learning)
  expect(tutor.saved).toBe(false)
})

test("citing unread lecture pages is rejected until the complete range has been read", async () => {
  const input = job()
  const tutor = await createTutorSession(input, () => {})
  const payload = { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [part] } }
  expect((await tutor.execute("topic_createTopic", payload)).success).toBe(false)
  expect((await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 1 })).success).toBe(true)
  expect((await tutor.execute("topic_createTopic", payload)).success).toBe(false)
  expect((await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 2, lastPage: 2 })).success).toBe(true)
  expect((await tutor.execute("topic_createTopic", payload)).success).toBe(true)
  expect((await tutor.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_plan_confirmation" })).success).toBe(true)
  const result = tutor.finish("The plan follows Lecture 3A.")
  expect(result.topicMutations).toMatchObject([{ type: "createTopic", materialIds: [input.chat.materials[0].id], topic: { content: [part] } }])
})

test("confirmed topics also reject replacing their attached curriculum with web sources", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  input.chat.materials = []
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  const result = await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [{ ...part, references: [{ type: "website", url: "https://example.com/binary" }] }] })
  expect(result.success).toBe(false)
})

test("the tutor reads the active lecture before teaching on a later turn", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part], threadTutors: [{ id: input.chat.id, progress: { "tp-binary": { status: "active", steps: [] } } }] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  expect((await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-binary", question: "Explain binary fractions." })).success).toBe(false)
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  expect((await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-binary", question: "Explain binary fractions." })).success).toBe(true)
})

test("summary-only teaching cannot skip reading the current lecture", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part], threadTutors: [{ id: input.chat.id, progress: { "tp-binary": { status: "active", steps: [] } } }] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  const payload = { topicId: "scratchpad_1", changes: [{ action: "add", block: { id: "walkthrough", type: "markdown", sectionId: "tp-binary", content: ["Binary fractions use negative powers of two."] } }] }
  expect((await tutor.execute("topic_editContent", payload)).success).toBe(false)
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  expect((await tutor.execute("topic_editContent", payload)).success).toBe(true)
})

test("teaching adds no blanket source footer and preserves citations beside relevant explanations", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part], threadTutors: [{ id: input.chat.id, progress: { "tp-binary": { status: "active", steps: [] } } }] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  const question = "How do positional weights determine the value?"
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: part.id, question })
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-binary", content: ["## Binary fractions\n\nEach position has a power-of-two weight."] } }] })
  const saved = await tutor.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", pendingQuestion: question, privateAnswerKey: "A place contributes its digit multiplied by its positional weight.", nextAction: "Wait for the answer.", workpad: "Waiting for the current check." })
  expect(saved.success).toBe(true)
  const illustration = "```mermaid\nflowchart LR\n  A[Place value] --> B[Weighted sum]\n```"
  const missingCitation = `Each binary position has a power-of-two weight.\n\n${illustration}\n\n${question}`
  const canonical = tutor.finish(missingCitation).reply
  expect(canonical).not.toContain("Source:")
  const citedExplanation = `The lecture shows fixed-width instructions. [Lecture](edu-material://${input.chat.materials[0].id}/1)\n\n![Instruction format](prune-source://${input.chat.materials[0].id}/1)`
  const citedReply = tutor.finish(citedExplanation).reply
  expect(citedReply).toContain(citedExplanation)
  expect(citedReply.indexOf("![Instruction format]")).toBeLessThan(citedReply.indexOf("> [!CHECK]"))
  expect(canonical).toContain(`> [!CHECK]\n> ${question}`)
  expect(tutor.previewReply(missingCitation)).toBe(canonical)
  let attempt = 0
  const result = await runTutorLoop({
    session: tutor,
    model: async () => { attempt++; return { reply: missingCitation, calls: [], finishAfterTools: false } },
    consumeTools: () => {}, recover: () => {}, maxAttempts: 1,
    exhausted: () => new Error("Source lines are rendered by the app"),
  })
  expect(attempt).toBe(1)
  expect(result.reply).toBe(canonical)
})

test("relative citations resolve against the active topic despite duplicate lecture filenames", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part], threadTutors: [{ id: input.chat.id, progress: { "tp-binary": { status: "active", steps: [] } } }] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const other = newTopic("Previous walkthrough")
  other.materials = [{ ...topic.materials[0], id: randomUUID() }]
  input.workspaceTopics.push({ ...other, notes: "Previous lecture notes" })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: topic.materials[0].id, firstPage: 1, lastPage: 2 })
  const question = "What is the positional weight."
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: part.id, question })
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", sectionId: "tp-binary", content: ["## Binary fractions\n\nEach position has a power-of-two weight."] } }] })
  expect((await tutor.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", pendingQuestion: question, privateAnswerKey: "A place contributes its digit multiplied by its positional weight.", workpad: "Awaiting the answer." })).success).toBe(true)
  const reply = "Each binary place has a power-of-two weight.\n\nSource: [Lecture](<assets/Lecture 3A.pdf#page=1>)\n\n> [!CHECK]\n> What is the positional weight?"
  const result = await runTutorLoop({
    session: tutor, model: async () => ({ reply, calls: [], finishAfterTools: false }),
    consumeTools: () => {}, recover: () => {}, maxAttempts: 1,
    exhausted: () => new Error("Unnecessary citation repair"),
  })
  expect(result.reply).toContain("[Lecture](<assets/Lecture 3A.pdf#page=1>)")
  expect(result.reply).toContain(question)
  expect(result.reply).not.toContain(other.materials[0].id)
})

test("completing a part cannot evade reading its source by removing its active status", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part], threadTutors: [{ id: input.chat.id, progress: { "tp-binary": { status: "active", steps: [] } } }] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  const payload = { topicId: "scratchpad_1", topicPartId: "tp-binary" }
  expect((await tutor.execute("topic_complete", payload)).success).toBe(false)
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  expect((await tutor.execute("topic_complete", payload)).success).toBe(true)
})

test("structured source blocks require a real material page before citation", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = input.chat.materials
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part] })
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  const edit = { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "source", id: "source", sectionId: "tp-binary", materialId: input.chat.materials[0].id, page: 1, presentation: "link" } }] }
  expect((await tutor.execute("topic_editContent", edit)).success).toBe(false)
  await tutor.execute("read_material", { id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 })
  expect((await tutor.execute("topic_editContent", edit)).success).toBe(true)
})

test("new topics can reuse a lecture read from another scratchpad", async () => {
  const input = job()
  const topic = newTopic("Lecture notes")
  topic.materials = input.chat.materials
  input.chat.materials = []
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: topic.materials[0].id, firstPage: 1, lastPage: 2 })
  const result = await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [part] } })
  expect(result.success).toBe(true)
})

test("borrowed slide decks use structural reference validation", async () => {
  const input = job()
  input.chat.materials[0].pages = ["1. Data Representation\nBits depend on their type.", "2. Decimal Number System\nDecimal digits have positional weights."]
  const source = newTopic("Source lectures")
  source.materials = input.chat.materials
  input.chat.materials = []
  input.topics.push({ ...source, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: source.materials[0].id, firstPage: 1, lastPage: 2 })
  const result = await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "New walkthrough", content: [part] } })
  expect(result.success).toBe(true)
})

test("curriculum replacement reviews and retains newly borrowed source sections", async () => {
  const input = job()
  const source = newTopic("Source lectures")
  source.materials = input.chat.materials
  source.materials[0].pages = ["1. Data Representation\nBits depend on type.", "2. Decimal Number System\nPositional notation."]
  input.chat.materials = []
  input.topics.push(...[newTopic("Target"), source].map((topic) => ({ ...topic, assetDirectory: input.assetDirectory })))
  const tutor = await createTutorSession(input, () => {})
  const first = { ...part, name: "Data Representation", references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 1, to: 1 }] }] }
  const second = { ...part, id: "tp-decimal", name: "Decimal Number System", references: [{ type: "pdf", path: "assets/Lecture 3A.pdf", pages: [{ from: 2, to: 2 }] }] }
  await tutor.execute("read_material", { id: source.materials[0].id, firstPage: 1, lastPage: 1 })
  expect((await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [first] })).success).toBe(false)
  await tutor.execute("read_material", { id: source.materials[0].id, firstPage: 2, lastPage: 2 })
  expect((await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [first] })).success).toBe(true)
  expect((await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [first, second] })).success).toBe(true)
})

test("teaching prefers the topic's attached lecture when chat filenames collide", async () => {
  const input = job()
  const topic = newTopic("Number systems")
  topic.materials = [...input.chat.materials]
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [part] })
  input.chat.materials = [{ ...topic.materials[0], id: randomUUID(), text: "Another lecture" }]
  input.topics.push({ ...topic, assetDirectory: input.assetDirectory })
  const tutor = await createTutorSession(input, () => {})
  await tutor.execute("read_material", { id: topic.materials[0].id, firstPage: 1, lastPage: 2 })
  expect((await tutor.execute("topic_activatePart", { topicId: "scratchpad_1", topicPartId: "tp-binary" })).success).toBe(true)
})

test("the tutor loop repairs a fabricated plan by reading attachments before publishing", async () => {
  const input = job()
  const tutor = await createTutorSession(input, () => {})
  const responses = [
    { reply: "An unrelated web plan", calls: [
      { name: "topic_createTopic", arguments: JSON.stringify({ topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [{ ...part, references: [{ type: "website", url: "https://example.com/binary" }] }] } }) },
      { name: "save_learning_state", arguments: JSON.stringify(input.chat.learning) },
    ], finishAfterTools: true },
    { reply: "", calls: [{ name: "read_material", arguments: JSON.stringify({ id: input.chat.materials[0].id, firstPage: 1, lastPage: 2 }) }], finishAfterTools: false },
    { reply: "Follow Lecture 3A: positional notation, then binary fractions.", calls: [
      { name: "topic_createTopic", arguments: JSON.stringify({ topic: { type: "topic", version: "11-10-2026", name: "Number systems", content: [part] } }) },
      { name: "save_learning_state", arguments: JSON.stringify({ ...input.chat.learning, phase: "awaiting_plan_confirmation" }) },
    ], finishAfterTools: true },
  ]
  const recovery: string[] = []
  const excerpts: string[] = []
  const result = await runTutorLoop({
    session: tutor,
    model: async (attempt) => {
      if (attempt === 3) expect(excerpts.join("\n")).toContain("Page 2\nBinary fractions")
      const response = responses.shift()
      if (!response) throw new Error("Unexpected model request")
      return response
    },
    consumeTools: (_calls, results) => { excerpts.push(...results.map((result) => result.text)) },
    recover: (message) => { recovery.push(message) },
    maxAttempts: 3, exhausted: () => new Error("Model budget exhausted"),
  })
  expect(recovery).toHaveLength(1)
  expect(result.reply).toBe("Follow Lecture 3A: positional notation, then binary fractions.")
  expect(result.topicMutations).toMatchObject([{ type: "createTopic", topic: { content: [part] } }])
})
