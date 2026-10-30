import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { z } from "zod"
import { WorkspaceSchema } from "../shared/contracts"
import { WorkflowRecordSchema } from "../shared/tutor-workflow"
import { ChatDatabase } from "./chat-database"
import { newChat, newScratchpad, WorkspaceRepository } from "./workspace"
import { StoredJsonSchema } from "./workspace-migrations"

test("legacy database fields migrate without losing scratchpad links or workflow context", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-database-migration-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "state.sqlite")
  const database = new ChatDatabase(path)
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "default" }
  const scratchpad = newScratchpad("Fractions", "topic")
  const chat = newChat(runner.id)
  chat.scratchpadHandles = [scratchpad.id]
  chat.learning.pendingCheck = { scratchpadId: scratchpad.id, scratchpadPartId: "tp-halves", stepIndex: 0 }
  const message = { id: randomUUID(), role: "user" as const, content: "topicId", createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] }
  chat.messages.push(message)
  const state = WorkspaceSchema.parse({ version: 2, runners: [runner], scratchpads: [scratchpad], chats: [chat] })
  const workflow = WorkflowRecordSchema.parse({
    turnId: randomUUID(), chatId: chat.id, learnerMessageId: message.id, status: "failed", attemptId: randomUUID(),
    source: { chat, runner, scratchpads: [{ ...scratchpad, assetDirectory: directory }], openedScratchpadId: scratchpad.id, skillDirectory: directory, assetDirectory: directory },
  })
  database.save(state, workflow)

  const { scratchpadIds, ...messageFields } = message
  const legacyMessage = { ...messageFields, topicIds: scratchpadIds }
  const { scratchpadHandles, learning, messages, ...chatFields } = chat
  const { pendingCheck, ...learningFields } = learning
  assert(pendingCheck)
  const legacyChat = { ...chatFields, topicHandles: scratchpadHandles, learning: { ...learningFields, pendingCheck: { topicId: pendingCheck.scratchpadId, topicPartId: pendingCheck.scratchpadPartId, stepIndex: 0 } } }
  const { scratchpads, workspaceScratchpads, openedScratchpadId, ...sourceFields } = workflow.source
  const legacyWorkflow = { ...workflow, source: { ...sourceFields, chat: { ...legacyChat, messages: [legacyMessage] }, topics: scratchpads, workspaceTopics: workspaceScratchpads, openedTopicId: openedScratchpadId } }
  const sqlite = new DatabaseSync(path)
  sqlite.prepare("UPDATE metadata SET key = 'topics' WHERE key = 'scratchpads'").run()
  sqlite.prepare("UPDATE metadata SET payload = ? WHERE key = 'removed_files'").run(JSON.stringify({ topics: [], chats: [] }))
  sqlite.prepare("UPDATE chats SET payload = ? WHERE id = ?").run(JSON.stringify(legacyChat), chat.id)
  sqlite.prepare("UPDATE messages SET payload = ? WHERE id = ?").run(JSON.stringify(legacyMessage), message.id)
  sqlite.prepare("UPDATE tutor_workflows SET payload = ? WHERE id = ?").run(JSON.stringify(legacyWorkflow), workflow.turnId)
  sqlite.exec("PRAGMA user_version = 1")
  sqlite.close()

  assert.deepEqual(database.load()?.state, state)
  assert.deepEqual(database.workflow(workflow.turnId), workflow)
  assert.deepEqual(database.load()?.state, state)
  const migrated = new DatabaseSync(path)
  try {
    assert.deepEqual(z.object({ user_version: z.number() }).parse(migrated.prepare("PRAGMA user_version").get()), { user_version: 2 })
    assert.equal(migrated.prepare("SELECT key FROM metadata WHERE key = 'topics'").get(), undefined)
  } finally {
    migrated.close()
  }
})

test("legacy field migration updates cached tool requirements while preserving content and scratchpad types", () => {
  assert.deepEqual(StoredJsonSchema.parse({
    type: "topic", content: "topicId", topic: { name: "Fractions" },
    properties: { topicId: { type: "string" } }, required: ["topicId"],
    topicIds: ["old"], scratchpadIds: ["new"],
  }), {
    type: "topic", content: "topicId", scratchpad: { name: "Fractions" },
    properties: { scratchpadId: { type: "string" } }, required: ["scratchpadId"], scratchpadIds: ["new"],
  })
})

test("reopening a workspace repairs saved topic-check clarification styling without changing ordinary clarifications", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-check-presentation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const database = new ChatDatabase(join(directory, "state.sqlite"))
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "default" }
  const scratchpad = newScratchpad("Structure-aware chunks", "topic")
  const topic = newChat(runner.id)
  const ordinary = newChat(runner.id)
  const question = "Does this row establish Model B's limit? Explain what is missing."
  topic.learning = { ...topic.learning, phase: "awaiting_clarification", pendingQuestion: question, privateAnswerKey: "No; the row refers to Model A", pendingCheck: { scratchpadId: scratchpad.id, scratchpadPartId: "tp-context", stepIndex: 0 } }
  topic.messages.push({ id: randomUUID(), role: "assistant", content: `The heading identifies Model A.\n\n${question}`, createdAt: topic.createdAt, scratchpadIds: [] })
  const materialRequest = "Could you attach the source document?"
  ordinary.learning = { ...ordinary.learning, phase: "awaiting_clarification", pendingQuestion: materialRequest }
  ordinary.messages.push({ id: randomUUID(), role: "assistant", content: materialRequest, createdAt: ordinary.createdAt, scratchpadIds: [] })
  database.save(WorkspaceSchema.parse({ version: 2, runners: [runner], scratchpads: [scratchpad], chats: [topic, ordinary] }))
  const workspace = new WorkspaceRepository(directory)
  const restored = await workspace.load()
  const expected = `The heading identifies Model A.\n\n> [!CHECK]\n> ${question}`
  assert.equal(restored.chats.find((chat) => chat.id === topic.id)?.messages.at(-1)?.content, expected)
  const persisted = database.load()
  assert.equal(persisted?.needsMessageMigration, false, "The repair must be stored, not reapplied on every read")
  assert.equal(persisted?.state.chats.find((chat) => chat.id === topic.id)?.messages.at(-1)?.content, expected)
  assert.equal(persisted?.state.chats.find((chat) => chat.id === ordinary.id)?.messages.at(-1)?.content, materialRequest)
  assert.equal((await workspace.load()).chats.find((chat) => chat.id === topic.id)?.messages.at(-1)?.content, expected, "Reopening must not add duplicate check cards")
})
