import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { ScratchpadStateSchema } from "../src/shared/scratchpad-state"
import { StateService } from "../src/main/state-service"
import { WorkspaceRepository } from "../src/main/workspace"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
const goal = { objective: "Explain limits", understoodWhen: ["Distinguish limits from function values"] }
const part = { id: "tp-limits", name: "Limits", references: [], goals: [goal], mistakes: [] }
const question = { title: "Limits at a hole", question: "What does the function approach?", reference: [], goals: [goal], mistakes: [] }

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "edu-scratchpads-"))
  directories.push(directory)
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  return { repository, directory, service: new StateService(repository, "thread-a") }
}

test("scratchpad states discriminate topic, test, and generic with goal arrays", () => {
  const base = { version: "19-10-2026", createdAt: new Date().toISOString(), name: "Review" }
  expect(ScratchpadStateSchema.parse({ ...base, type: "generic", references: [] }).type).toBe("generic")
  expect(ScratchpadStateSchema.parse({ ...base, type: "test", goals: [goal], questions: [], references: [], content: [part] }).type).toBe("test")
  expect(ScratchpadStateSchema.parse({ ...base, version: "11-10-2026", type: "topic", content: [part], threadTutors: [] }).type).toBe("topic")
  expect(() => ScratchpadStateSchema.parse({ ...base, type: "test", references: [] })).toThrow()
})

test("test question writers, open questions, answers and markdown survive reload", async () => {
  const { repository, directory, service } = await setup()
  const id = await service.createTest({ type: "test", version: "19-10-2026", name: "Review", goals: [goal], references: [], content: [part], questions: [question] })
  const other = new StateService(repository, "thread-b")
  const initial = repository.topic(id).state
  expect(await other.whereAmIForTest(id)).toMatchObject({ title: question.title, threadWriters: ["thread-a"] })
  expect(repository.topic(id).state).toEqual(initial)
  await other.documentTestMistake(id, part.id, "Asked about a hole", "Confused value with limit")
  expect(await service.getTestQuestions(id)).toMatchObject([{ threadWriters: ["thread-a"] }])
  await other.recordTestAnswer(id, question.title, "It approaches 3")
  await expect(service.recordTestAnswer(id, question.title, "Overwrite")).rejects.toThrow(/already/)
  await service.addTestQuestion(id, { ...question, title: "A transfer question" })
  expect(await service.whereAmIForTest(id)).toMatchObject({ title: "A transfer question" })
  const notes = await readFile(join(directory, "scratchpads", id, "scratchpad.md"), "utf8")
  expect(notes).toContain("## Limits at a hole\nWhat does the function approach?\n\n### You answered\nIt approaches 3")
  const reloaded = new WorkspaceRepository(directory)
  await reloaded.load()
  expect(reloaded.topic(id).state).toMatchObject({ type: "test", questions: [{ answer: "It approaches 3", threadWriters: ["thread-a", "thread-b"] }, { title: "A transfer question" }] })
  expect(JSON.parse(await readFile(join(directory, "scratchpads", id, "scratchpad.state.json"), "utf8"))).toMatchObject({ type: "test" })
})

test("generic references are serialized by the shared mutex and role tools reject wrong types", async () => {
  const { repository, service } = await setup()
  const id = await service.createGeneric({ type: "generic", version: "19-10-2026", name: "Notes", references: [] })
  await Promise.all([
    service.addGenericReference(id, { type: "website", url: "https://example.com/a" }),
    new StateService(repository, randomUUID()).addGenericReference(id, { type: "topic", id: randomUUID() }),
  ])
  expect(await service.getGenericReferences(id)).toHaveLength(2)
  expect(repository.topic(id).state).not.toHaveProperty("threadTutors")
  expect(repository.topic(id).state).not.toHaveProperty("threadWriters")
  await expect(service.whereAmI(id)).rejects.toThrow(/topic/)
  await expect(service.getTestQuestions(id)).rejects.toThrow(/test/)
  await expect(service.activatePart(id, part.id)).rejects.toThrow(/topic/)
})

test("references reject pages outside an already attached source", async () => {
  const { repository, service } = await setup()
  const id = await service.createGeneric({ type: "generic", version: "19-10-2026", name: "Sources", references: [] })
  await repository.mutate((state) => {
    state.topics.find((item) => item.id === id)!.materials.push({ id: randomUUID(), name: "lecture.pdf", kind: "pdf", text: "One page", pages: ["One page"] })
  })
  await expect(service.addGenericReference(id, { type: "pdf", path: "assets/lecture.pdf", pages: [{ from: 1, to: 2 }] })).rejects.toThrow(/outside/)
  expect(await service.getGenericReferences(id)).toEqual([])
})


test("startup removes interrupted scratchpad atomic writes without touching learner files", async () => {
  const { directory, service } = await setup()
  const id = await service.createGeneric({ type: "generic", version: "19-10-2026", name: "Notes", references: [] })
  const root = join(directory, "scratchpads", id)
  const stale = join(root, `scratchpad.state.json.${randomUUID()}.tmp`)
  const learnerFile = join(root, "solution.tmp")
  await writeFile(stale, "Interrupted state")
  await writeFile(learnerFile, "Learner notes")
  await new WorkspaceRepository(directory).load()
  await expect(readFile(stale)).rejects.toThrow(/ENOENT/)
  expect(await readFile(learnerFile, "utf8")).toBe("Learner notes")
})

test("new test questions reject model answers before any learner response", async () => {
  const { repository, service } = await setup()
  const answeredQuestion = { ...question, answer: "A model-generated solution, not the learner's answer" }
  await expect(service.createTest({ type: "test", version: "19-10-2026", name: "Prefilled", goals: [], references: [], content: [], questions: [answeredQuestion] })).rejects.toThrow()
  expect(repository.stateSnapshot.topics).toHaveLength(0)
  const id = await service.createTest({ type: "test", version: "19-10-2026", name: "Review", goals: [], references: [], content: [], questions: [] })
  await expect(service.addTestQuestion(id, answeredQuestion)).rejects.toThrow()
  expect(await service.getTestQuestions(id)).toEqual([])
  expect(repository.topic(id).learning.notes).not.toContain("You answered")
  await service.addTestQuestion(id, question)
  expect((await service.getTestQuestions(id))[0]).not.toHaveProperty("answer")
  expect(repository.topic(id).learning.notes).not.toContain("You answered")
  await service.recordTestAnswer(id, question.title, "My actual answer")
  expect(repository.topic(id).learning.notes).toContain("### You answered\nMy actual answer")
})
