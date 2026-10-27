import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { isStagedChat } from "../shared/thread-ownership"
import { ScratchpadStateSchema, type ScratchpadTypeSchema } from "../shared/scratchpad-state"
import { z } from "zod"
import { applyScratchpadMutation } from "./state-service"
import { newChat, newScratchpad, WorkspaceRepository } from "./workspace"

async function fixture(t: TestContext, type: z.infer<typeof ScratchpadTypeSchema>) {
  const directory = await mkdtemp(join(tmpdir(), "edu-scratchpad-files-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  const scratchpad = newScratchpad("Saved scratchpad", type)
  if (type === "generic") scratchpad.learning.notes += "Keep these notes exactly.\n"
  const chat = newChat(repository.stateSnapshot.runners[0].id)
  chat.ownerScratchpadId = scratchpad.id
  await repository.mutate((state) => { state.scratchpads.push(scratchpad); state.chats.push(chat) })
  const markdownPath = join(directory, "scratchpads", scratchpad.id, "scratchpad.md")
  const statePath = join(directory, "scratchpads", scratchpad.id, "scratchpad.state.json")
  return { directory, repository, scratchpad, chat, markdownPath, statePath }
}

for (const type of ["topic", "test", "generic"] as const) {
  test(`${type}: missing Markdown stays in error until regenerated`, async (t) => {
    const { directory, repository, scratchpad, chat, markdownPath, statePath } = await fixture(t, type)
    const markdown = await readFile(markdownPath, "utf8")
    const structured = await readFile(statePath, "utf8")
    await rm(markdownPath)
    await repository.refreshTopics()
    assert.equal(repository.scratchpad(scratchpad.id).fileError, "missing-markdown")
    assert.equal(repository.chat(chat.id).ownerScratchpadId, scratchpad.id)
    assert.equal(isStagedChat(repository.chat(chat.id)), false)
    await repository.mutate((state) => { state.scratchpads[0].archived = true })
    await assert.rejects(readFile(markdownPath), { code: "ENOENT" })
    assert.equal(await readFile(statePath, "utf8"), structured)
    const reopened = new WorkspaceRepository(directory)
    await reopened.load()
    assert.equal(reopened.publicTopics[0].fileError, "missing-markdown")
    await assert.rejects(reopened.reconcileScratchpad({ scratchpadId: scratchpad.id, action: "convert-to-generic" }), /without its Markdown/)
    await reopened.reconcileScratchpad({ scratchpadId: scratchpad.id, action: "regenerate" })
    assert.equal(await readFile(markdownPath, "utf8"), markdown)
    assert.equal(reopened.scratchpad(scratchpad.id).fileError, undefined)
    assert.equal(reopened.scratchpad(scratchpad.id).archived, true)
    assert.equal(reopened.chat(chat.id).ownerScratchpadId, scratchpad.id)
  })

  for (const corruption of ["missing", "invalid JSON", "invalid schema"] as const) {
    test(`${type}: ${corruption} state preserves Markdown until conversion`, async (t) => {
      const { directory, repository, scratchpad, chat, markdownPath, statePath } = await fixture(t, type)
      const markdown = await readFile(markdownPath, "utf8")
      if (corruption === "missing") await rm(statePath)
      else if (corruption === "invalid JSON") await writeFile(statePath, "{broken")
      else await writeFile(statePath, '{"type":"topic"}')
      await repository.refreshTopics()
      assert.equal(repository.scratchpad(scratchpad.id).fileError, "missing-state")
      assert.equal(repository.scratchpad(scratchpad.id).state, undefined)
      assert.equal(repository.scratchpad(scratchpad.id).learning.notes, markdown)
      await repository.mutate((state) => { state.scratchpads[0].archived = true })
      assert.equal(await readFile(markdownPath, "utf8"), markdown)
      if (corruption === "missing") await assert.rejects(readFile(statePath), { code: "ENOENT" })
      else assert.equal(await readFile(statePath, "utf8"), corruption === "invalid JSON" ? "{broken" : '{"type":"topic"}')
      const reopened = new WorkspaceRepository(directory)
      await reopened.load()
      assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-state")
      await assert.rejects(reopened.reconcileScratchpad({ scratchpadId: scratchpad.id, action: "regenerate" }), /without a valid/)
      await reopened.reconcileScratchpad({ scratchpadId: scratchpad.id, action: "convert-to-generic" })
      assert.equal(await readFile(markdownPath, "utf8"), markdown)
      const state = ScratchpadStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")))
      assert.equal(state.type, "generic")
      assert.equal(state.createdAt, scratchpad.createdAt)
      assert.equal(reopened.scratchpad(scratchpad.id).fileError, undefined)
      assert.equal(reopened.scratchpad(scratchpad.id).planConfirmed, true)
      assert.equal(reopened.chat(chat.id).ownerScratchpadId, scratchpad.id)
    })
  }

  test(`${type}: both files missing remain unrecoverable after saves and reopen`, async (t) => {
    const { directory, repository, scratchpad, chat, markdownPath, statePath } = await fixture(t, type)
    await rm(markdownPath)
    await rm(statePath)
    await repository.refreshTopics()
    assert.equal(repository.scratchpad(scratchpad.id).fileError, "missing-both")
    assert.throws(() => applyScratchpadMutation(repository.stateSnapshot, chat.id, { type: "updateGeneric", scratchpadId: scratchpad.id, summary: "Must not replace missing files" }), /Reconcile/)
    await repository.mutate((state) => { state.scratchpads[0].archived = true })
    const reopened = new WorkspaceRepository(directory)
    await reopened.load()
    assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-both")
    assert.equal(reopened.chat(chat.id).ownerScratchpadId, scratchpad.id)
    assert.equal(isStagedChat(reopened.chat(chat.id)), false)
    for (const action of ["regenerate", "convert-to-generic"] as const)
      await assert.rejects(reopened.reconcileScratchpad({ scratchpadId: scratchpad.id, action }), /Cannot/)
    await assert.rejects(readFile(markdownPath), { code: "ENOENT" })
    await assert.rejects(readFile(statePath), { code: "ENOENT" })
    await writeFile(statePath, "{}")
    await reopened.refreshTopics()
    assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-both")
  })
}

test("generic Markdown needs only to exist, including an empty file or no title header", async (t) => {
  const { repository, scratchpad, markdownPath, statePath } = await fixture(t, "generic")
  for (const markdown of ["", "No title header\n\nKeep this content.\n"]) {
    await writeFile(markdownPath, markdown)
    await repository.refreshTopics()
    assert.equal(repository.scratchpad(scratchpad.id).fileError, undefined)
    assert.equal(repository.scratchpad(scratchpad.id).learning.notes, markdown)
    await rm(statePath)
    await repository.reconcileScratchpad({ scratchpadId: scratchpad.id, action: "convert-to-generic" })
    assert.equal(await readFile(markdownPath, "utf8"), markdown)
  }
})

test("a completed scratchpad with both files missing stays visible after its current metadata entry was dropped", async (t) => {
  const { directory, scratchpad, markdownPath, statePath } = await fixture(t, "generic")
  await rm(markdownPath)
  await rm(statePath)
  const database = new DatabaseSync(join(directory, "state.sqlite"))
  database.prepare("UPDATE metadata SET payload = '[]' WHERE key = 'scratchpads'").run()
  database.close()
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const entry = reopened.publicTopics.find((item) => item.id === scratchpad.id)
  assert.ok(entry, "The completed scratchpad must remain visible as an error entry")
  assert.equal(entry.title, scratchpad.title)
  assert.equal(entry.fileError, "missing-both")
})
