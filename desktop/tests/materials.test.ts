import { TopicStateSchema } from "../src/shared/topic-state"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { importMaterials, MaterialDrafts } from "../src/main/materials"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"
import { StateService } from "../src/main/state-service"
import { parseTopicDirectory } from "../src/shared/topic-directory"
import { resolveMaterialLink } from "../src/shared/material-links"

const selection = vi.hoisted(() => ({ canceled: false, filePaths: [] as string[] }))
vi.mock("electron", () => ({ dialog: { showOpenDialog: async () => selection } }))
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "edu-import-cleanup-"))
  directories.push(directory)
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const chat = newChat(repository.stateSnapshot.runners[0].id)
  await repository.mutate((state) => state.chats.push(chat))
  const source = join(directory, "source.txt")
  await writeFile(source, "Useful study material")
  selection.filePaths = [source]
  selection.canceled = false
  return { repository, chat, source, destination: join(repository.directory, "chats", chat.id, "assets", "source.txt") }
}

test("a structured lecture text reference copies its asset and survives reload without advancing progress", async () => {
  const { repository, chat, source } = await fixture()
  const name = "Lecture 4 - Code used in lecture.txt"
  const lecture = join(repository.directory, name)
  await writeFile(lecture, await readFile(source))
  await importMaterials(repository, { kind: "chat", id: chat.id }, [lecture])
  const material = repository.chat(chat.id).materials[0]
  const topic = newTopic("Fresh Walkthrough")
  await repository.mutate((state) => state.topics.push(topic))
  const service = new StateService(repository, chat.id)
  const content = ["4a", "4c"].map((section) => ({
    id: `tp-${section}`, name: section.toUpperCase(), references: [],
    goals: [{ objective: "Trace the code", understoodWhen: ["Explain the output"] }], mistakes: [],
  }))
  await service.updateTopic(topic.id, { content })
  await service.activatePart(topic.id, "tp-4c")
  await service.complete(topic.id, "tp-4c")
  await service.updateTopic(topic.id, {
    materialIds: [material.id],
    content: [{ ...content[0], references: [{ type: "other-file", path: `assets/${name}` }] }, content[1]],
  })
  const reloaded = new WorkspaceRepository(repository.directory)
  await reloaded.load()
  const saved = reloaded.topic(topic.id)
  expect(TopicStateSchema.parse(saved.state).content[0].references).toEqual([{ type: "other-file", path: "assets/Lecture 4 - Code used in lecture.txt" }])
  expect(TopicStateSchema.parse(saved.state).threadTutors).toEqual([{ id: chat.id, progress: { "tp-4c": { status: "completed", steps: [] } } }])
  expect(await readFile(join(repository.directory, "scratchpads", topic.id, "assets", name), "utf8")).toBe("Useful study material")
  const citation = parseTopicDirectory(saved.learning.notes).directory?.items[0].sources[0]
  expect(citation).toEqual({ label: "Lecture 4.txt", href: "assets/Lecture 4 - Code used in lecture.txt" })
  expect(resolveMaterialLink(citation?.href ?? "", saved.materials)).toEqual({ id: material.id, page: 1 })
})

test("removes copied assets when a later import validation fails", async () => {
  const { repository, chat, source, destination } = await fixture()
  selection.filePaths = [source, source]
  await expect(importMaterials(repository, { kind: "chat", id: chat.id })).rejects.toThrow("already attached")
  await expect(readFile(destination)).rejects.toThrow()
  expect(repository.chat(chat.id).materials).toEqual([])
})

test("keeps committed assets and does not overwrite them on a duplicate import", async () => {
  const { repository, chat, source, destination } = await fixture()
  await importMaterials(repository, { kind: "chat", id: chat.id })
  await writeFile(source, "Different contents")
  await expect(importMaterials(repository, { kind: "chat", id: chat.id })).rejects.toThrow("already attached")
  expect(await readFile(destination, "utf8")).toBe("Useful study material")
})

test("cleans copied files when the database mutation fails", async () => {
  const { repository, chat, destination } = await fixture()
  vi.spyOn(repository, "mutate").mockRejectedValueOnce(new Error("Database save failed"))
  await expect(importMaterials(repository, { kind: "chat", id: chat.id })).rejects.toThrow("Database save failed")
  await expect(readFile(destination)).rejects.toThrow()
})

test("keeps assets when a post-commit file write fails", async () => {
  const { repository, chat, destination } = await fixture()
  const mutate = repository.mutate.bind(repository)
  vi.spyOn(repository, "mutate").mockImplementationOnce(async (update) => {
    await mutate(update)
    throw new Error("Post-commit mirror failed")
  })
  await expect(importMaterials(repository, { kind: "chat", id: chat.id })).rejects.toThrow("Post-commit mirror failed")
  expect(await readFile(destination, "utf8")).toBe("Useful study material")
  expect(repository.chat(chat.id).materials).toHaveLength(1)
})

test("keeps selected materials in a draft through cancellation and imports them without reopening the picker", async () => {
  const { repository, chat, destination } = await fixture()
  const drafts = new MaterialDrafts()
  const selected = await drafts.select([])
  expect(selected).toEqual([{ id: expect.any(String), name: "source.txt" }])
  expect(repository.chat(chat.id).materials).toEqual([])
  await expect(readFile(destination)).rejects.toThrow()
  const ids = selected.map((material) => material.id)
  selection.canceled = true
  expect(await drafts.select(ids)).toEqual(selected)
  await drafts.import(repository, { kind: "chat", id: chat.id }, ids)
  expect(repository.chat(chat.id).materials).toHaveLength(1)
  expect(await readFile(destination, "utf8")).toBe("Useful study material")
  await expect(drafts.import(repository, { kind: "chat", id: chat.id }, ids)).rejects.toThrow("Select the learning materials again")
})

test("a failed draft import retains the selection for retry", async () => {
  const { repository, chat } = await fixture()
  const drafts = new MaterialDrafts()
  const ids = (await drafts.select([])).map((material) => material.id)
  vi.spyOn(repository, "mutate").mockRejectedValueOnce(new Error("Database save failed"))
  await expect(drafts.import(repository, { kind: "chat", id: chat.id }, ids)).rejects.toThrow("Database save failed")
  await drafts.import(repository, { kind: "chat", id: chat.id }, ids)
  expect(repository.chat(chat.id).materials).toHaveLength(1)
})

test("rejects duplicate names across draft selections without losing the existing selection", async () => {
  await fixture()
  const drafts = new MaterialDrafts()
  const selected = await drafts.select([])
  const ids = selected.map((material) => material.id)
  await expect(drafts.select(ids)).rejects.toThrow("already attached")
  selection.canceled = true
  expect(await drafts.select(ids)).toEqual(selected)
})

test("combines dropped files with picker drafts and imports their contents", async () => {
  const { repository, chat, source, destination } = await fixture()
  const drafts = new MaterialDrafts()
  const selected = await drafts.select([])
  const droppedSource = join(repository.directory, "dropped.md")
  await writeFile(droppedSource, "Dropped learning notes")
  selection.canceled = true
  const combined = await drafts.add(selected.map((material) => material.id), [droppedSource])
  expect(combined.map((material) => material.name)).toEqual(["source.txt", "dropped.md"])
  await expect(drafts.add(combined.map((material) => material.id), [source])).rejects.toThrow("already attached")
  await drafts.import(repository, { kind: "chat", id: chat.id }, combined.map((material) => material.id))
  expect(repository.chat(chat.id).materials).toHaveLength(2)
  expect(await readFile(destination, "utf8")).toBe("Useful study material")
  expect(await readFile(join(repository.directory, "chats", chat.id, "assets", "dropped.md"), "utf8"))
    .toBe("Dropped learning notes")
})

test("rejects folders and excessive drop batches without losing existing drafts", async () => {
  const { repository, source } = await fixture()
  const drafts = new MaterialDrafts()
  const selected = await drafts.add([], [source])
  const ids = selected.map((material) => material.id)
  await expect(drafts.add(ids, [repository.directory])).rejects.toThrow("is a folder")
  await expect(drafts.add(ids, Array.from({ length: 12 }, () => source))).rejects.toThrow("up to 12")
  selection.canceled = true
  expect(await drafts.select(ids)).toEqual(selected)
})

test("imports PowerPoint slides in presentation order with speaker notes and preserves the original deck", async () => {
  const { repository, chat } = await fixture()
  const source = resolve("tests/fixtures/materials/lecture.pptx")
  const drafts = new MaterialDrafts()
  const selected = await drafts.add([], [source])
  await drafts.import(repository, { kind: "chat", id: chat.id }, selected.map((material) => material.id))
  const material = repository.chat(chat.id).materials[0]
  expect(material.name).toBe("lecture.pptx")
  expect(material.pages).toHaveLength(2)
  expect(material.pages[0]).toContain("MIPS & registers")
  expect(material.pages[0]).toContain("add $t0, $t1, $t2")
  expect(material.pages[0]).toContain("Registers store 32-bit values.")
  expect(material.pages[1]).toContain("Memory instructions")
  expect(material.text).toContain("lw $t0, 0($t1)")
  expect(await readFile(join(repository.directory, "chats", chat.id, "assets", "lecture.pptx")))
    .toEqual(await readFile(source))
})

test("rejects a corrupt PowerPoint without saving an attachment or copying its asset", async () => {
  const { repository, chat } = await fixture()
  const source = join(repository.directory, "broken.pptx")
  await writeFile(source, "This is not a PowerPoint archive")
  await expect(importMaterials(repository, { kind: "chat", id: chat.id }, [source])).rejects.toThrow()
  expect(repository.chat(chat.id).materials).toHaveLength(0)
  await expect(readFile(join(repository.directory, "chats", chat.id, "assets", "broken.pptx"))).rejects.toThrow()
})

test("clipboard images remain draft attachments until import and retain their bytes", async () => {
  const { repository, chat, source } = await fixture()
  const drafts = new MaterialDrafts()
  const selected = await drafts.add([], [source])
  const data = new Uint8Array(await readFile(resolve("src/renderer/assets/app-icon.png")))
  const pasted = await drafts.paste(selected.map((draft) => draft.id), [{ mimeType: "image/png", data }])
  expect(pasted).toHaveLength(2)
  expect(repository.chat(chat.id).materials).toHaveLength(0)
  selection.canceled = true
  expect(await drafts.select(pasted.map((draft) => draft.id))).toEqual(pasted)
  await drafts.import(repository, { kind: "chat", id: chat.id }, pasted.map((draft) => draft.id))
  const image = repository.chat(chat.id).materials.find((material) => material.kind === "image")
  expect(image).toBeDefined()
  expect(await readFile(join(repository.directory, "chats", chat.id, "assets", image!.name))).toEqual(Buffer.from(data))
})

test("discarded clipboard attachments cannot be imported or retained in the draft", async () => {
  const { repository, chat } = await fixture()
  const drafts = new MaterialDrafts()
  const data = new Uint8Array(await readFile(resolve("src/renderer/assets/app-icon.png")))
  const pasted = await drafts.paste([], [{ mimeType: "image/png", data }])
  const ids = pasted.map((draft) => draft.id)
  drafts.discard(ids)
  await expect(drafts.import(repository, { kind: "chat", id: chat.id }, ids)).rejects.toThrow("Select the learning materials again")
  expect(repository.chat(chat.id).materials).toHaveLength(0)
})
