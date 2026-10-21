import { expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { newTopic, WorkspaceRepository } from "../src/main/workspace"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TopicStateSchema } from "../src/shared/topic-state"
import { parseTopicDirectory } from "../src/shared/topic-directory"
import { StateService } from "../src/main/state-service"

const part = (id = "tp-limits", name = "Limits") => ({
  id, name, references: [],
  goals: [{ objective: `Explain ${name}`, understoodWhen: ["Justify the reasoning"] }],
  mistakes: [],
})

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "edu-state-"))
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  const topic = newTopic("Calculus")
  await repository.mutate((state) => state.topics.push(topic))
  const threadId = randomUUID()
  const service = new StateService(repository, threadId)
  await service.updateTopic(topic.id, { content: [part(), part("tp-derivatives", "Derivatives")] })
  return { directory, repository, topic, threadId, service }
}

test("structured state validates references and rejects duplicate parts and reversed pages", () => {
  const state = { type: "topic", version: "11-10-2026", createdAt: new Date().toISOString(), name: "Limits", content: [part()], threadTutors: [] }
  expect(TopicStateSchema.parse(state).content[0].id).toBe("tp-limits")
  expect(TopicStateSchema.safeParse({ ...state, content: [part(), part()] }).success).toBe(false)
  for (const path of ["/etc/passwd", "../outside.pdf", "assets/../../outside.pdf", "C:\\secret.pdf"]) {
    expect(TopicStateSchema.safeParse({ ...state, content: [{ ...part(), references: [{ type: "pdf", path, pages: [{ from: 1, to: 2 }] }] }] }).success).toBe(false)
  }
  expect(TopicStateSchema.safeParse({ ...state, content: [{ ...part(), references: [{ type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 3, to: 1 }] }] }] }).success).toBe(false)
})

test("reads do not register threads and continuation returns all active threads plus only the next untouched part", async () => {
  const setup = await workspace()
  try {
    const { repository, topic, service, threadId } = setup
    const secondThread = randomUUID()
    const reader = new StateService(repository, secondThread)
    expect(await reader.whereAmI(topic.id)).toEqual([])
    await reader.whatIsNext(topic.id)
    await reader.getQuestions(topic.id, "tp-limits")
    await reader.getMistakesForTopic(null)
    expect(TopicStateSchema.parse(repository.topic(topic.id).state).threadTutors.map((thread) => thread.id)).toEqual([threadId])
    await service.activatePart(topic.id, "tp-limits")
    await service.recordQuestion(topic.id, "tp-limits", "Why does the limit exist?")
    await reader.activatePart(topic.id, "tp-limits")
    const choices = await reader.whatIsNext(topic.id)
    expect(choices.map((choice) => choice.label)).toEqual(["Continue from Why does the limit exist?", "Continue from Limits", "Continue to Derivatives"])
    expect(choices[0].threadId).toBe(threadId)
    expect(choices[2].part.id).toBe("tp-derivatives")
    await service.complete(topic.id, "tp-limits")
    await service.activatePart(topic.id, "tp-limits")
    expect((await service.whereAmI(topic.id))[0].progress.status).toBe("active")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("concurrent writers preserve each thread, answers, and mistakes across reload without changing the summary", async () => {
  const setup = await workspace()
  try {
    const { repository, topic, service } = setup
    const original = await readFile(join(setup.directory, "scratchpads", topic.id, "scratchpad.md"), "utf8")
    const other = new StateService(repository, randomUUID())
    await Promise.all([service.activatePart(topic.id, "tp-limits"), other.activatePart(topic.id, "tp-derivatives")])
    await service.recordQuestion(topic.id, "tp-limits", "What is a limit?")
    await service.recordAnswer(topic.id, "tp-limits", "An approached value")
    await Promise.all([
      service.documentMistake(topic.id, "tp-limits", "Confused value and limit", "A limit need not equal the value"),
      other.documentMistake(topic.id, "tp-derivatives", "Dropped a factor", "Chain rule needs the inner derivative"),
    ])
    const reloaded = new WorkspaceRepository(setup.directory)
    await reloaded.load()
    const state = TopicStateSchema.parse(reloaded.topic(topic.id).state)
    expect(state?.threadTutors).toHaveLength(2)
    expect(state?.threadTutors[0].progress["tp-limits"].steps).toEqual([{ question: "What is a limit?", answerFromUser: "An approached value" }])
    expect(await new StateService(reloaded, randomUUID()).getMistakesForTopic(null)).toHaveLength(2)
    expect(await readFile(join(setup.directory, "scratchpads", topic.id, "scratchpad.md"), "utf8")).toBe(original)
    expect(TopicStateSchema.parse(JSON.parse(await readFile(join(setup.directory, "scratchpads", topic.id, "scratchpad.state.json"), "utf8"))).threadTutors).toHaveLength(2)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("a fresh thread sees walkthrough coverage without treating it as mastery or an active continuation", async () => {
  const setup = await workspace()
  try {
    const { topic, service, repository, threadId } = setup
    await service.updateTopic(topic.id, { content: [part(), part("tp-derivatives", "Derivatives"), part("tp-integrals", "Integrals")] })
    for (const id of ["tp-limits", "tp-derivatives"]) {
      await service.activatePart(topic.id, id)
      await service.recordQuestion(topic.id, id, "Explain this example.")
      await service.recordAnswer(topic.id, id, "The limit depends on nearby values; the point itself can be undefined.")
      await service.complete(topic.id, id)
    }
    const reloaded = new WorkspaceRepository(setup.directory)
    await reloaded.load()
    const reader = new StateService(reloaded, randomUUID())
    expect(await reader.whereAmI(topic.id)).toEqual([])
    expect(TopicStateSchema.parse(reloaded.topic(topic.id).state).threadTutors[0].progress["tp-limits"].status).toBe("completed")
    expect(await reader.getTopicProgress(topic.id)).toMatchObject([
      { part: { id: "tp-limits" }, threads: [{ threadId, progress: { status: "completed" } }] },
      { part: { id: "tp-derivatives" }, threads: [{ threadId, progress: { status: "completed" } }] },
      { part: { id: "tp-integrals" }, threads: [] },
    ])
    expect((await reader.whatIsNext(topic.id)).map((choice) => choice.part.id)).toEqual(["tp-integrals"])
    expect(TopicStateSchema.parse(reloaded.topic(topic.id).state).threadTutors).toHaveLength(1)
    expect((await reader.getQuestions(topic.id, "tp-limits"))[0].answerFromUser).toContain("nearby values")
    await service.activatePart(topic.id, "tp-limits")
    expect((await service.whereAmI(topic.id))[0].progress.status).toBe("active")
    await service.complete(topic.id, "tp-limits")
    expect(TopicStateSchema.parse(repository.topic(topic.id).state).threadTutors[0].progress["tp-limits"].status).toBe("completed")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("invalid writes are atomic and unvisited parts cannot be completed", async () => {
  const setup = await workspace()
  try {
    const { repository, topic } = setup
    const outsider = new StateService(repository, randomUUID())
    const before = repository.topic(topic.id).state
    await expect(outsider.complete(topic.id, "tp-limits")).rejects.toThrow(/active|visit/i)
    await expect(outsider.documentMistake(topic.id, "tp-missing", "context", "issue")).rejects.toThrow(/part/i)
    expect(repository.topic(topic.id).state).toEqual(before)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("topic creation registers only its writer and creates the summary, state and assets", async () => {
  const setup = await workspace()
  try {
    const id = await setup.service.createTopic({ type: "topic", version: "11-10-2026", name: "Prerequisite", content: [part("tp-algebra", "Algebra")] })
    const topic = setup.repository.topic(id)
    expect(TopicStateSchema.parse(topic.state).threadTutors).toEqual([{ id: setup.threadId, progress: {} }])
    expect(await readFile(join(setup.directory, "scratchpads", id, "scratchpad.md"), "utf8")).toContain('"title":"Algebra"')
    const { stat } = await import("node:fs/promises")
    expect((await stat(join(setup.directory, "scratchpads", id, "assets"))).isDirectory()).toBe(true)
    expect(JSON.parse(await readFile(join(setup.directory, "scratchpads", id, "scratchpad.state.json"), "utf8"))).toMatchObject({ name: "Prerequisite", type: "topic", version: "11-10-2026" })
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("existing Markdown topics start structured progress fresh and keep their legacy files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-fresh-state-"))
  try {
    const { mkdir, writeFile } = await import("node:fs/promises")
    const id = randomUUID()
    const root = join(directory, "scratchpads", id)
    await mkdir(root, { recursive: true })
    const notes = "# Old topic\n\n## Past Mistakes\nLegacy mistake and question evidence."
    const workpad = "Legacy pending question and checked key."
    await writeFile(join(root, "scratchpad.md"), notes)
    await writeFile(join(root, "agent.workpad.md"), workpad)
    const repository = new WorkspaceRepository(directory)
    await repository.load()
    expect(repository.topic(id).state).toMatchObject({ content: [], threadTutors: [] })
    expect(await readFile(join(root, "scratchpad.md"), "utf8")).toBe(notes)
    expect(await readFile(join(root, "agent.workpad.md"), "utf8")).toBe(workpad)
    expect(await new StateService(repository, randomUUID()).getMistakesForTopic(null)).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("curriculum edits preserve recorded mistakes and cannot remove referenced parts", async () => {
  const setup = await workspace()
  try {
    const { service, topic, repository } = setup
    await service.activatePart(topic.id, "tp-limits")
    await service.documentMistake(topic.id, "tp-limits", "Original attempt", "Original error")
    await service.updateTopic(topic.id, { content: [part()] })
    expect(TopicStateSchema.parse(repository.topic(topic.id).state).content[0].mistakes).toEqual([{ context: "Original attempt", issue: "Original error" }])
    await expect(service.updateTopic(topic.id, { content: [] })).rejects.toThrow(/mistakes|missing part/i)
    expect(TopicStateSchema.parse(repository.topic(topic.id).state).content).toHaveLength(1)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("corrupt structured state is rejected without replacing it or its summary", async () => {
  const setup = await workspace()
  try {
    const { writeFile } = await import("node:fs/promises")
    const path = join(setup.directory, "scratchpads", setup.topic.id, "scratchpad.state.json")
    const summary = await readFile(join(setup.directory, "scratchpads", setup.topic.id, "scratchpad.md"), "utf8")
    await writeFile(path, '{"version":"future-version"}')
    await expect(new WorkspaceRepository(setup.directory).load()).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe('{"version":"future-version"}')
    expect(await readFile(join(setup.directory, "scratchpads", setup.topic.id, "scratchpad.md"), "utf8")).toBe(summary)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("curriculum revisions and renames retain a conceptual summary unless explicitly replaced", async () => {
  const setup = await workspace()
  try {
    await setup.service.write({ type: "editTopicContent", topicId: setup.topic.id, changes: [{ action: "add", block: { type: "markdown", id: "example", sectionId: "tp-limits", content: ["Useful source explanation."] } }] })
    await setup.service.updateTopic(setup.topic.id, { content: [part()] })
    await setup.service.updateTopic(setup.topic.id, { name: "Calculus review" })
    expect(setup.repository.topic(setup.topic.id).learning.notes).toMatch(/^# Calculus review\n/ )
    expect(setup.repository.topic(setup.topic.id).learning.notes).toContain("Useful source explanation.")
    expect(setup.repository.topic(setup.topic.id).state?.name).toBe("Calculus review")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("a committed plan confirmation survives interrupted file mirrors without rewriting legacy handoffs", async () => {
  const setup = await workspace()
  try {
    const { ChatDatabase } = await import("../src/main/chat-database")
    const workpadPath = join(setup.directory, "scratchpads", setup.topic.id, "agent.workpad.md")
    const legacy = "Unused legacy handoff."
    const { writeFile } = await import("node:fs/promises")
    await writeFile(workpadPath, legacy)
    const committed = setup.repository.stateSnapshot
    committed.topics[0].planConfirmed = true
    const database = new ChatDatabase(join(setup.directory, "state.sqlite"))
    database.save(committed)
    const reloaded = new WorkspaceRepository(setup.directory)
    await reloaded.load()
    expect(reloaded.topic(setup.topic.id).planConfirmed).toBe(true)
    expect(await readFile(workpadPath, "utf8")).toBe(legacy)
    expect(database.load()?.filesPending).toBe(false)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("a skipped question remains unanswered while a later question can be asked and answered", async () => {
  const setup = await workspace()
  try {
    await setup.service.activatePart(setup.topic.id, "tp-limits")
    await setup.service.recordQuestion(setup.topic.id, "tp-limits", "Question the learner chose to skip")
    await setup.service.recordQuestion(setup.topic.id, "tp-limits", "Replacement question")
    await setup.service.recordAnswer(setup.topic.id, "tp-limits", "Actual answer", 1)
    expect(await setup.service.getQuestions(setup.topic.id, "tp-limits")).toMatchObject([
      { question: "Question the learner chose to skip" },
      { question: "Replacement question", answerFromUser: "Actual answer" },
    ])
    expect((await setup.service.getQuestions(setup.topic.id, "tp-limits"))[0]).not.toHaveProperty("answerFromUser")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})


test("new curricula scaffold a navigable summary without presenting goals as taught explanations", async () => {
  const setup = await workspace()
  try {
    const notes = setup.repository.topic(setup.topic.id).learning.notes
    expect(parseTopicDirectory(notes).directory?.items.map((entry) => entry.title)).toEqual(["Limits", "Derivatives"])
    expect(notes).toContain("## Topic terminology")
    expect(notes).not.toContain("## Materials")
    expect(notes).not.toContain("Explain Limits")
    expect(notes).not.toContain("## Limits")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("structured terminology is rendered after explanations", async () => {
  const setup = await workspace()
  try {
    await setup.service.write({ type: "editTopicContent", topicId: setup.topic.id, changes: [
      { action: "add", block: { type: "term", id: "limit-term", term: "Limit", meaning: "The value approached by nearby positions." } },
      { action: "add", block: { type: "markdown", id: "example", sectionId: "tp-limits", content: ["## Following a moving car", "", "As the car approaches a junction, its position approaches a value."] } },
    ] })
    const notes = setup.repository.topic(setup.topic.id).learning.notes
    expect(notes).toContain("Following a moving car")
    expect(notes.trim().endsWith("| Limit | The value approached by nearby positions. |")).toBe(true)
    expect(parseTopicDirectory(notes).directory?.items[0]).toMatchObject({ title: "Limits", anchor: "tp-limits" })
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("stale topic workpads cannot restore progress or prevent JSON state loading", async () => {
  const setup = await workspace()
  try {
    const { writeFile } = await import("node:fs/promises")
    const root = join(setup.directory, "scratchpads", setup.topic.id)
    await writeFile(join(root, "agent.workpad.md"), "## Handoff\nPhase: invalid\nLegacy secret answer")
    await writeFile(join(root, "topic.workpad.md"), "Legacy pending question")
    await setup.service.activatePart(setup.topic.id, "tp-limits")
    const reloaded = new WorkspaceRepository(setup.directory)
    await reloaded.load()
    expect(await new StateService(reloaded, setup.threadId).whereAmI(setup.topic.id)).toMatchObject([{ part: { id: "tp-limits" } }])
    expect(reloaded.topic(setup.topic.id).learning.privateAnswerKey).toBe("")
    expect(reloaded.topic(setup.topic.id).learning.workpad).not.toContain("Legacy")
    expect(await readFile(join(root, "agent.workpad.md"), "utf8")).toContain("Phase: invalid")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("topic writes and recovery do not create per-topic workpads", async () => {
  const setup = await workspace()
  try {
    const root = join(setup.directory, "scratchpads", setup.topic.id)
    await setup.service.activatePart(setup.topic.id, "tp-limits")
    await new WorkspaceRepository(setup.directory).load()
    await expect(readFile(join(root, "agent.workpad.md"))).rejects.toThrow(/ENOENT/)
    await expect(readFile(join(root, "topic.workpad.md"))).rejects.toThrow(/ENOENT/)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})


test("curriculum edits derive hierarchy and stable anchors while retaining explanation blocks", async () => {
  const setup = await workspace()
  try {
    const first = part()
    await setup.service.write({ type: "editTopicContent", topicId: setup.topic.id, changes: [{ action: "add", block: { type: "markdown", id: "example", sectionId: first.id, content: ["A limit describes the approached value."] } }] })
    await setup.service.updateTopic(setup.topic.id, { content: [first, { ...part("tp-one-sided", "One-sided limits"), parent: { id: first.id } }] })
    expect(parseTopicDirectory(setup.repository.topic(setup.topic.id).learning.notes).directory?.items).toMatchObject([
      { title: "Limits", anchor: "tp-limits", children: [{ title: "One-sided limits" }] },
    ])
    await setup.service.updateTopic(setup.topic.id, { content: [{ ...first, name: "Limits of functions" }] })
    const notes = setup.repository.topic(setup.topic.id).learning.notes
    expect(parseTopicDirectory(notes).directory?.items[0]).toMatchObject({ title: "Limits of functions", anchor: "tp-limits" })
    expect(notes).toContain("A limit describes the approached value.")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})

test("the summary directory renders curricula accepted by the structured topic schema", async () => {
  const setup = await workspace()
  try {
    const name = `A topic part with a long source heading ${"x".repeat(300)}`
    const content = Array.from({ length: 101 }, (_, index) => ({
      ...part(`tp-section-${index}`, `Section ${index}`),
    }))
    content[0].name = name
    const references = Array.from({ length: 11 }, (_, index) => ({ type: "website" as const, url: `https://example.com/source-${index}` }))
    await setup.service.updateTopic(setup.topic.id, { content: [{ ...content[0], references }, ...content.slice(1)] })
    const parsed = parseTopicDirectory(setup.repository.topic(setup.topic.id).learning.notes)
    expect(parsed.error).toBeUndefined()
    expect(parsed.directory?.items).toHaveLength(101)
    expect(parsed.directory?.items[0].title).toBe(name)
    expect(parsed.directory?.items[0].sources).toHaveLength(11)
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})


test("editing an explanation cannot drop its generated navigation target", async () => {
  const setup = await workspace()
  try {
    await setup.service.write({ type: "editTopicContent", topicId: setup.topic.id, changes: [{ action: "add", block: { type: "markdown", id: "example", sectionId: "tp-limits", content: ["## Following a moving car", "", "Nearby positions approach the junction."] } }] })
    await setup.service.write({ type: "editTopicContent", topicId: setup.topic.id, changes: [{ action: "edit", block: { type: "markdown", id: "example", sectionId: "tp-limits", content: ["## Following a moving cyclist", "", "A different explanation without any HTML anchors."] } }] })
    const reloaded = new WorkspaceRepository(setup.directory)
    await reloaded.load()
    expect(parseTopicDirectory(reloaded.topic(setup.topic.id).learning.notes).directory?.items[0].anchor).toBe("tp-limits")
    expect(reloaded.topic(setup.topic.id).learning.notes).toContain("different explanation")
  } finally { await rm(setup.directory, { recursive: true, force: true }) }
})
