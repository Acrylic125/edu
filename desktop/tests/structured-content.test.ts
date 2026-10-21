import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"
import { StateService } from "../src/main/state-service"
import { ScratchpadStateSchema, TestStateSchema } from "../src/shared/scratchpad-state"
import { parseTopicDirectory } from "../src/shared/topic-directory"
import { importStructuredContent } from "../src/main/structured-content-migration"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
async function fixture(type: "topic" | "test" = "topic") {
  const directory = await mkdtemp(join(tmpdir(), "edu-structured-content-"))
  directories.push(directory)
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  const topic = newTopic("MIPS", type)
  const chat = newChat(randomUUID())
  await repository.mutate((state) => { state.topics.push(topic); state.chats.push(chat) })
  const service = new StateService(repository, chat.id)
  const content = [{ id: "tp-encoding", name: "Encoding", references: [], goals: [], mistakes: [] }]
  if (type === "topic") await service.updateTopic(topic.id, { content })
  else await service.write({ type: "updateTest", topicId: topic.id, content })
  const root = join(directory, "scratchpads", topic.id)
  return { directory, root, repository, topic, service }
}

test.each(["topic", "test"] as const)("%s edits commit JSON blocks and generate navigation without model-authored anchors", async (type) => {
  const { root, repository, topic, service } = await fixture(type)
  const operation = type === "topic" ? "editTopicContent" : "editTestContent"
  await service.write({ type: operation, topicId: topic.id, changes: [
    { action: "add", block: { type: "markdown", id: "setup", sectionId: "tp-encoding", content: ["A fixed-width instruction has 32 bits."] } },
    { action: "add", block: { type: "term", id: "word", term: "Instruction", meaning: "An encoded operation." } },
  ] })
  const stored = ScratchpadStateSchema.parse(JSON.parse(await readFile(join(root, "scratchpad.state.json"), "utf8")))
  if (stored.type === "generic") throw new Error("Wrong fixture type")
  expect(stored.document?.blocks.map((block) => block.id)).toEqual(["setup", "word"])
  const markdown = await readFile(join(root, "scratchpad.md"), "utf8")
  expect(markdown).toContain('<a id="tp-encoding"></a>')
  expect(markdown).toContain("A fixed-width instruction has 32 bits.")
  expect(parseTopicDirectory(markdown).directory?.items[0].anchor).toBe("tp-encoding")
  await service.write({ type: operation, topicId: topic.id, expectedRevision: stored.revision, changes: [
    { action: "edit", block: { type: "markdown", id: "setup", sectionId: "tp-encoding", content: ["Each instruction occupies four bytes."] } },
    { action: "delete", id: "word" },
  ] })
  expect(repository.topic(topic.id).learning.notes).toContain("four bytes")
  expect(repository.topic(topic.id).learning.notes).not.toContain("32 bits")
})

test("a failed operation or stale revision rolls back the complete edit batch", async () => {
  const { root, repository, topic, service } = await fixture()
  const before = await readFile(join(root, "scratchpad.state.json"), "utf8")
  await expect(service.write({ type: "editTopicContent", topicId: topic.id, changes: [
    { action: "add", block: { type: "markdown", id: "example", sectionId: "tp-encoding", content: ["Must not survive."] } },
    { action: "delete", id: "missing" },
  ] })).rejects.toThrow("not found")
  expect(await readFile(join(root, "scratchpad.state.json"), "utf8")).toBe(before)
  await service.write({ type: "editTopicContent", topicId: topic.id, changes: [{ action: "add", block: { type: "markdown", id: "example", sectionId: "tp-encoding", content: ["Current content."] } }] })
  await expect(service.write({ type: "editTopicContent", topicId: topic.id, expectedRevision: 0, changes: [{ action: "delete", id: "example" }] })).rejects.toThrow("changed")
  expect(repository.topic(topic.id).learning.notes).toContain("Current content.")
})

test("JSON remains authoritative after external Markdown changes or a missing projection", async () => {
  const { root, directory, topic, service } = await fixture()
  await service.write({ type: "editTopicContent", topicId: topic.id, changes: [{ action: "add", block: { type: "markdown", id: "example", sectionId: "tp-encoding", content: ["Authoritative explanation."] } }] })
  await writeFile(join(root, "scratchpad.md"), "# Wrong title\n\nDivergent external copy.")
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  expect(repository.topic(topic.id).title).toBe("MIPS")
  expect(repository.topic(topic.id).learning.notes).toContain("Authoritative explanation.")
  await rm(join(root, "scratchpad.md"))
  await repository.refreshTopics()
  expect(await readFile(join(root, "scratchpad.md"), "utf8")).toContain("Authoritative explanation.")
})

test("legacy Markdown is backed up and imported once without losing explanations or progress", async () => {
  const { root, repository, topic, directory } = await fixture()
  const stored = ScratchpadStateSchema.parse(repository.topic(topic.id).state)
  if (stored.type !== "topic") throw new Error("Wrong fixture type")
  delete stored.document
  stored.threadTutors = [{ id: "legacy-thread", progress: { "tp-encoding": { status: "active", steps: [{ question: "Why fixed width?", answerFromUser: "Simple decoding" }] } } }]
  const markdown = '# MIPS\n\n<a id="tp-encoding"></a>\n\n## A worked example\n\n`add $8, $9, $10` uses registers.\n\n## Topic terminology\n\n| Term | Meaning |\n|---|---|\n| Encoding | Binary representation |'
  await writeFile(join(root, "scratchpad.state.json"), JSON.stringify(stored))
  await writeFile(join(root, "scratchpad.md"), markdown)
  const reloaded = new WorkspaceRepository(directory)
  await reloaded.load()
  const migrated = ScratchpadStateSchema.parse(reloaded.topic(topic.id).state)
  if (migrated.type !== "topic") throw new Error("Wrong fixture type")
  expect(migrated.document?.blocks).toContainEqual(expect.objectContaining({ type: "markdown", sectionId: "tp-encoding", content: ["`add $8, $9, $10` uses registers."] }))
  expect(migrated.document?.blocks).toContainEqual(expect.objectContaining({ type: "term", term: "Encoding", meaning: "Binary representation" }))
  expect(migrated.threadTutors).toEqual(stored.threadTutors)
  expect(await readFile(join(root, "scratchpad.legacy.md"), "utf8")).toBe(markdown)
  expect(importStructuredContent(migrated, "Different text")).toEqual(migrated)
})

test("source blocks use material IDs and the app chooses link or image syntax", async () => {
  const { repository, topic, service } = await fixture()
  const id = randomUUID()
  await repository.mutate((state) => { state.topics[0].materials.push({ id, name: "Lecture.pdf", kind: "pdf", text: "Example", pages: ["Example"] }) })
  await service.write({ type: "editTopicContent", topicId: topic.id, changes: [{ action: "add", block: { type: "source", id: "slide", sectionId: "tp-encoding", materialId: id, page: 1, presentation: "image" } }] })
  expect(repository.topic(topic.id).learning.notes).toContain(`![Lecture.pdf, p. 1](prune-source://${id}/1)`)
  await expect(service.write({ type: "editTopicContent", topicId: topic.id, changes: [{ action: "edit", block: { type: "source", id: "slide", sectionId: "tp-encoding", materialId: id, page: 2, presentation: "link" } }] })).rejects.toThrow("outside")
})
