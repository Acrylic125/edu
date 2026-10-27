import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { MessageSchema } from "../shared/contracts"
import { newChat, newScratchpad, WorkspaceRepository } from "./workspace"

test("completed scratchpads retain creation threads while missing files are reconciled", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-file-backed-threads-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  const scratchpad = newScratchpad("Created notes", "generic")
  const creator = newChat(randomUUID())
  creator.messages.push(MessageSchema.parse({ id: randomUUID(), role: "assistant", content: "Created notes", scratchpadIds: [scratchpad.id], createdAt: new Date().toISOString() }))
  const reference = newChat(creator.runnerId)
  reference.messages.push(MessageSchema.parse({ id: randomUUID(), role: "user", content: "Use these notes", scratchpadIds: [scratchpad.id], createdAt: new Date().toISOString() }))
  await repository.mutate((state) => { state.scratchpads.push(scratchpad); state.chats.push(creator, reference) })
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  assert.equal(reopened.chat(creator.id).ownerScratchpadId, scratchpad.id)
  assert.equal(reopened.chat(reference.id).ownerScratchpadId, undefined)
  const markdownPath = join(directory, "scratchpads", scratchpad.id, "scratchpad.md")
  const statePath = join(directory, "scratchpads", scratchpad.id, "scratchpad.state.json")
  const markdown = await readFile(markdownPath)
  const structured = await readFile(statePath)
  await rm(markdownPath)
  await reopened.refreshTopics()
  assert.equal(reopened.chat(creator.id).ownerScratchpadId, scratchpad.id)
  assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-markdown")
  await writeFile(markdownPath, markdown)
  await rm(statePath)
  await reopened.refreshTopics()
  assert.equal(reopened.chat(creator.id).ownerScratchpadId, scratchpad.id)
  assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-state")
  await writeFile(statePath, structured)
  await reopened.refreshTopics()
  assert.equal(reopened.chat(creator.id).ownerScratchpadId, scratchpad.id)
  assert.equal(reopened.scratchpad(scratchpad.id).fileError, undefined)
  await rm(markdownPath)
  await rm(statePath)
  await reopened.refreshTopics()
  assert.equal(reopened.chat(creator.id).ownerScratchpadId, scratchpad.id)
  assert.equal(reopened.scratchpad(scratchpad.id).fileError, "missing-both")
})
