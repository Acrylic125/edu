import { DatabaseSync } from "node:sqlite"
import { z } from "zod"
import { ChatDatabase } from "../src/main/chat-database"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), "prune-store-"))
  directories.push(directory)
  const store = new WorkspaceRepository(directory)
  await store.load()
  return store
}

test("persists concurrent changes without losing topics and restores private pending state", async () => {
  const store = await repository()
  const first = newTopic("Calculus")
  first.planConfirmed = true
  first.learning = {
    ...first.learning,
    phase: "awaiting_answer",
    pendingQuestion: "Explain the derivative in your own words.",
    privateAnswerKey: "A rate of change defined by a limit.",
    nextAction: "Evaluate the explanation, then teach the chain rule.",
    workpad: "Private checked key and handoff.",
  }
  await Promise.all([
    store.mutate((state) => state.topics.push(first)),
    store.mutate((state) => state.topics.push(newTopic("Physics"))),
  ])
  const restored = new WorkspaceRepository(store.directory)
  await restored.load()
  expect(restored.stateSnapshot.topics).toHaveLength(2)
  expect(restored.topic(first.id).learning).toEqual(first.learning)
  expect(JSON.stringify(restored.publicTopics)).not.toContain(
    first.learning.privateAnswerKey,
  )
  expect(JSON.stringify(restored.publicTopics)).not.toContain(
    first.learning.workpad,
  )
})

test("rejects invalid mutations and keeps the last valid disk snapshot", async () => {
  const store = await repository()
  const original = new ChatDatabase(join(store.directory, "state.sqlite")).load()?.state
  await expect(
    store.mutate((state) => (state.runners[0].name = "")),
  ).rejects.toThrow()
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.state).toEqual(original)
  await store.mutate((state) => (state.runners[0].name = "Recovered"))
  expect(store.stateSnapshot.runners[0].name).toBe("Recovered")
})

test.each([1, 2] as const)("starts a saved workspace with Codex tool version %s", async (toolVersion) => {
  const store = await repository()
  const chat = newChat(store.stateSnapshot.runners[0].id)
  chat.providerSession = {
    provider: "codex",
    threadId: "native-thread",
    home: "/private/codex",
    executable: "/bundled/codex",
    toolVersion,
    status: "ready",
  }
  await store.mutate((state) => state.chats.push(chat))

  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.chats.find((item) => item.id === chat.id)).toEqual(chat)
})

test("migrates per-topic conversations into independent chats and removes the workspace file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-store-"))
  directories.push(directory)
  const runnerId = randomUUID()
  const topic = newTopic("Calculus")
  const legacy = JSON.stringify({
    version: 1,
    runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "default" }],
    topics: [
      {
        ...topic,
        runnerId,
        messages: [
          { id: randomUUID(), role: "user", content: "Teach me", createdAt: topic.createdAt },
        ],
      },
      { ...newTopic("Unused"), runnerId, messages: [] },
    ],
  })
  await writeFile(join(directory, "workspace.json"), legacy)
  const store = new WorkspaceRepository(directory)
  await store.load()
  const { topics, chats } = store.stateSnapshot
  expect(topics).toHaveLength(2)
  expect(topics[0]).not.toHaveProperty("messages")
  expect(chats).toHaveLength(1)
  expect(chats[0]).toMatchObject({ title: "Calculus", runnerId })
  expect(chats[0].messages[0]).toMatchObject({ content: "Teach me", topicIds: [topic.id] })
  expect(await readdir(directory)).not.toContain("workspace.json")
  const restored = await new WorkspaceRepository(directory).load()
  expect(restored.topics).toEqual(topics)
  expect(restored.chats).toEqual(chats)
})

test("does not replace a corrupt legacy workspace with an empty one", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-store-"))
  directories.push(directory)
  await writeFile(join(directory, "workspace.json"), "invalid json")
  await expect(
    new WorkspaceRepository(directory).load(),
  ).rejects.toThrow()
  expect(await readFile(join(directory, "workspace.json"), "utf8")).toBe(
    "invalid json",
  )
})

test("migrates v2 chats and settings into SQLite while retaining editable topic files", async () => {
  const store = await repository()
  const topic = newTopic("Calculus")
  const chat = newChat(store.stateSnapshot.runners[0].id)
  const settings = { id: "claude", displayName: "My Claude", binaryPath: "/usr/bin/claude", enabled: true }
  const legacy = { ...store.stateSnapshot, topics: [topic], chats: [chat], providerSettings: [settings] }
  await rm(join(store.directory, "state.sqlite"))
  await rm(join(store.directory, "settings.json"), { force: true })
  await writeFile(join(store.directory, "workspace.json"), JSON.stringify(legacy))
  const migrated = await new WorkspaceRepository(store.directory).load()
  expect(migrated).toEqual(legacy)
  expect(await readdir(store.directory)).not.toContain("workspace.json")
  await expect(readFile(join(store.directory, "settings.json"))).rejects.toThrow()
  expect(await readdir(join(store.directory, "topics", topic.id))).not.toContain("topic.json")
  expect(await readFile(join(store.directory, "topics", topic.id, "agent.workpad.md"), "utf8")).toMatch(/^## Handoff\n/)
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.state.chats).toEqual([chat])
  await expect(readFile(join(store.directory, "workspace.legacy.json"))).rejects.toThrow()
})

test("reads renamed and edited Markdown without overwriting it when a chat changes", async () => {
  const store = await repository()
  const topic = newTopic("Calculus")
  await store.mutate((state) => state.topics.push(topic))
  const path = join(store.directory, "topics", topic.id, "topic.md")
  const notes = "# Calculus and Limits\n\nManually edited study notes.\n"
  await writeFile(path, notes)
  await store.refreshTopics()
  expect(store.topic(topic.id)).toMatchObject({ title: "Calculus and Limits", learning: { notes } })
  await store.mutate((state) => state.chats.push(newChat(state.runners[0].id)))
  expect(await readFile(path, "utf8")).toBe(notes)
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.topics[0]).toMatchObject({ title: "Calculus and Limits", learning: { notes } })
})

test("discovers documents added to the topics folder and removes deleted topics", async () => {
  const store = await repository()
  const topic = newTopic("Calculus")
  await store.mutate((state) => state.topics.push(topic))
  await rm(join(store.directory, "topics", topic.id), { recursive: true })
  const addedId = randomUUID()
  const directory = join(store.directory, "topics", addedId)
  await mkdir(directory)
  await writeFile(join(directory, "topic.md"), "# Geometry\n\nTriangles.")
  await store.refreshTopics()
  expect(store.stateSnapshot.topics).toHaveLength(1)
  expect(store.topic(addedId).title).toBe("Geometry")
  await expect(Promise.resolve().then(() => store.topic(topic.id))).rejects.toThrow("no longer exists")
})

test("renames the topic from the first header when a tutor saves notes with another heading", async () => {
  const store = await repository()
  const topic = newTopic("Create a Topic")
  await store.mutate((state) => state.topics.push(topic))
  await store.mutate((state) => { state.topics[0].learning.notes = "# MIPS Part 1\n\nAn explanation." })
  const notes = await readFile(join(store.directory, "topics", topic.id, "topic.md"), "utf8")
  expect(notes).toBe("# MIPS Part 1\n\nAn explanation.")
  expect(store.topic(topic.id).title).toBe("MIPS Part 1")
  expect((await new WorkspaceRepository(store.directory).load()).topics[0].title).toBe("MIPS Part 1")
})

test("keeps the topic title header when a tutor saves notes without one", async () => {
  const store = await repository()
  const topic = newTopic("Calculus")
  await store.mutate((state) => state.topics.push(topic))
  await store.mutate((state) => { state.topics[0].learning.notes = "An explanation." })
  const notes = await readFile(join(store.directory, "topics", topic.id, "topic.md"), "utf8")
  expect(notes).toBe("# Calculus\n\nAn explanation.")
})

test("rejects corrupt database and topic state without replacing their files", async () => {
  const store = await repository()
  await writeFile(join(store.directory, "state.sqlite"), "invalid database")
  await expect(new WorkspaceRepository(store.directory).load()).rejects.toThrow()
  expect(await readFile(join(store.directory, "state.sqlite"), "utf8")).toBe("invalid database")
  const other = await repository()
  const topic = newTopic("Calculus")
  await other.mutate((state) => state.topics.push(topic))
  const path = join(other.directory, "topics", topic.id, "agent.workpad.md")
  const corrupt = (await readFile(path, "utf8")).replace(/^Phase: .*$/m, "Phase: unknown")
  await writeFile(path, corrupt)
  await expect(new WorkspaceRepository(other.directory).load()).rejects.toThrow()
  expect(await readFile(path, "utf8")).toBe(corrupt)
})

test("stores topic state in the Tutor Me layout and derives it back from the files", async () => {
  const store = await repository()
  const topic = newTopic("Limits")
  topic.planConfirmed = true
  topic.materials.push({ id: randomUUID(), name: "Lecture 1.pdf", kind: "pdf", text: "Page one", pages: ["Page one"] })
  topic.learning = {
    ...topic.learning,
    phase: "awaiting_answer",
    currentSection: "1. Limits",
    pendingQuestion: "C1-01 — [question](topic.md#check-c1-01)\n\nExplain a limit.",
    privateAnswerKey: "The value a function approaches.\n\n## Not a section",
    nextAction: "Evaluate C1-01.",
    notes: `# Limits\n\n<topic-directory heading="Topic directory" items='[{"title":"1. Limits","children":[{"title":"1.1 One-sided limits"}]}]' />`,
    workpad: "Source map: Lecture 1.pdf pages 1-4.",
  }
  await store.mutate((state) => state.topics.push(topic))
  const directory = join(store.directory, "topics", topic.id)
  expect(await readdir(directory)).not.toContain("topic.json")
  expect(await readFile(join(directory, "agent.workpad.md"), "utf8")).toBe(
    `## Handoff\nCreated: ${topic.createdAt}\nPlan: confirmed\nPhase: awaiting_answer\nCurrent section: 1. Limits\nActive check: C1-01 — [question](topic.md#check-c1-01)\n  \n  Explain a limit.\nResume action: Evaluate C1-01.\n\n## Active check key\nThe value a function approaches.\n\n## Not a section\n\n## Working notes\nSource map: Lecture 1.pdf pages 1-4.`,
  )
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.topics[0]).toEqual({ ...topic, learning: { ...topic.learning, outline: ["1. Limits", "1.1 One-sided limits"] } })
})

test("migrates topic.json into the workpad handoff and material caches", async () => {
  const store = await repository()
  const topic = newTopic("Limits")
  await store.mutate((state) => state.topics.push(topic))
  const directory = join(store.directory, "topics", topic.id)
  const material = { id: randomUUID(), name: "Lecture 1.pdf", kind: "pdf", text: "Page one", pages: ["Page one"] }
  const { id: _id, title: _title, learning, ...metadata } = topic
  const { notes: _notes, workpad: _workpad, ...handoff } = learning
  await writeFile(join(directory, "topic.json"), JSON.stringify({ ...metadata, planConfirmed: true, materials: [material], learning: { ...handoff, phase: "ready_to_continue" } }))
  await writeFile(join(directory, "agent.workpad.md"), "Legacy handoff.")
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.topics[0]).toMatchObject({ planConfirmed: true, materials: [material], learning: { phase: "ready_to_continue", workpad: "Legacy handoff." } })
  expect(await readdir(directory)).not.toContain("topic.json")
  expect(JSON.parse(await readFile(join(directory, "assets", "cache", "prepared", material.id, "manifest.json"), "utf8"))).toEqual(material)
  expect((await new WorkspaceRepository(store.directory).load()).topics).toEqual(restored.topics)
})

test("learner exports omit the private handoff and assessment keys", async () => {
  const store = await repository()
  const topic = newTopic("Algebra")
  topic.learning.notes = "# Algebra\n\nA learner-facing explanation."
  topic.learning.privateAnswerKey = "Secret marking key"
  topic.learning.workpad = "Secret marking key"
  const output = join(store.directory, "export")
  await store.exportStudyFiles(topic, output)
  expect(await readFile(join(output, "topic.md"), "utf8")).toBe(
    topic.learning.notes,
  )
  await expect(
    readFile(join(output, "agent.workpad.md"), "utf8"),
  ).rejects.toThrow()
})


test("imports JSON chats once and uses SQLite after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-json-migration-"))
  directories.push(directory)
  const runnerId = randomUUID()
  const chat = newChat(runnerId, "Imported")
  chat.messages.push({ id: randomUUID(), role: "user", content: "Keep this conversation", createdAt: new Date().toISOString(), topicIds: [] })
  await mkdir(join(directory, "chats", chat.id), { recursive: true })
  const path = join(directory, "chats", chat.id, "chat.json")
  const original = JSON.stringify(chat)
  await writeFile(path, original)
  await writeFile(join(directory, "settings.json"), JSON.stringify({ version: 3, runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "default" }], providerSettings: [] }))
  const store = new WorkspaceRepository(directory)
  await store.load()
  expect(store.chat(chat.id)).toEqual(chat)
  await store.mutate((state) => { state.chats[0].title = "Updated" })
  await expect(readFile(path, "utf8")).rejects.toThrow()
  expect((await new WorkspaceRepository(directory).load()).chats[0].title).toBe("Updated")
  const database = new DatabaseSync(join(directory, "state.sqlite"))
  try {
    expect(database.prepare("SELECT sequence FROM events WHERE entity_id = ? ORDER BY sequence").all(chat.id).length).toBeGreaterThan(1)
    expect(z.object({ count: z.number() }).parse(database.prepare("SELECT COUNT(*) AS count FROM messages").get()).count).toBe(1)
  } finally { database.close() }
})

test("rolls back chats, messages, and topic changes together on a database failure", async () => {
  const store = await repository()
  const topic = newTopic("Before")
  const chat = newChat(store.stateSnapshot.runners[0].id)
  const message = { id: randomUUID(), role: "user" as const, content: "Original", createdAt: new Date().toISOString(), topicIds: [] }
  chat.messages.push(message)
  await store.mutate((state) => { state.topics.push(topic); state.chats.push(chat) })
  await expect(store.mutate((state) => {
    state.topics[0].learning.notes = "# Before\n\nShould not be written."
    const other = newChat(state.runners[0].id)
    other.messages.push(message)
    state.chats.push(other)
  })).rejects.toThrow()
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.chats).toEqual([chat])
  expect(restored.topics[0].learning.notes).toBe(topic.learning.notes)
  await store.mutate((state) => { state.chats[0].title = "Still usable" })
  expect(store.chat(chat.id).title).toBe("Still usable")
})

test("recovers topic mirrors after a committed transaction is interrupted", async () => {
  const store = await repository()
  const topic = newTopic("Recovery")
  await store.mutate((state) => state.topics.push(topic))
  const state = store.stateSnapshot
  const chat = newChat(state.runners[0].id)
  chat.learning.workpad = "Committed handoff"
  state.chats.push(chat)
  state.topics[0].learning.notes = "# Recovery\n\nCommitted notes."
  new ChatDatabase(join(store.directory, "state.sqlite")).save(state)
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.chats[0].learning.workpad).toBe("Committed handoff")
  expect(restored.topics[0].learning.notes).toBe(state.topics[0].learning.notes)
  expect(await readFile(join(store.directory, "topics", topic.id, "topic.md"), "utf8")).toBe(state.topics[0].learning.notes)
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.filesPending).toBe(false)
})

test("does not resurrect deleted topics after an interrupted mirror cleanup", async () => {
  const store = await repository()
  const topic = newTopic("Deleted")
  await store.mutate((state) => state.topics.push(topic))
  const state = store.stateSnapshot
  state.topics = []
  new ChatDatabase(join(store.directory, "state.sqlite")).save(state)
  expect((await new WorkspaceRepository(store.directory).load()).topics).toEqual([])
  await expect(readFile(join(store.directory, "topics", topic.id, "topic.md"))).rejects.toThrow()
})


test("does not import stale JSON over a damaged initialized database", async () => {
  const store = await repository()
  const database = new DatabaseSync(join(store.directory, "state.sqlite"))
  database.prepare("DELETE FROM metadata WHERE key = 'settings'").run()
  database.close()
  await expect(new WorkspaceRepository(store.directory).load()).rejects.toThrow("incomplete")
})


test("prunes obsolete files and orphan chats while preserving live assets and learner documents", async () => {
  const store = await repository()
  const chat = newChat(store.stateSnapshot.runners[0].id)
  const topic = newTopic("Keep")
  await store.mutate((state) => { state.chats.push(chat); state.topics.push(topic) })
  const chatDirectory = join(store.directory, "chats", chat.id)
  await mkdir(join(chatDirectory, "assets"), { recursive: true })
  await writeFile(join(chatDirectory, "assets", "keep.txt"), "Attached source")
  const stale = join(chatDirectory, `chat.json.${randomUUID()}.tmp`)
  await writeFile(stale, "Interrupted write")
  await writeFile(join(chatDirectory, "chat.json"), "Obsolete backup")
  await writeFile(join(store.directory, "workspace.legacy.json"), "Obsolete backup")
  await writeFile(join(store.directory, "settings.json"), "Obsolete mirror")
  const orphan = join(store.directory, "chats", randomUUID())
  await mkdir(orphan)
  await writeFile(join(orphan, "unused.txt"), "Orphan")
  const learnerFile = join(store.directory, "topics", topic.id, "solution.tmp")
  await writeFile(learnerFile, "Keep learner work")
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.chats).toEqual([chat])
  expect(await readFile(join(chatDirectory, "assets", "keep.txt"), "utf8")).toBe("Attached source")
  expect(await readFile(learnerFile, "utf8")).toBe("Keep learner work")
  for (const path of [stale, orphan, join(chatDirectory, "chat.json"), join(store.directory, "workspace.legacy.json"), join(store.directory, "settings.json")])
    await expect(readFile(path)).rejects.toThrow()
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.removedFiles).toEqual({ topics: [], chats: [] })
})

test("preserves migration sources when database verification fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-invalid-migration-"))
  directories.push(directory)
  const runnerId = randomUUID()
  const first = newChat(runnerId)
  const second = newChat(runnerId)
  const message = { id: randomUUID(), role: "user" as const, content: "Preserve", createdAt: new Date().toISOString(), topicIds: [] }
  first.messages.push(message)
  second.messages.push(message)
  const raw = JSON.stringify({ version: 2, runners: [{ id: runnerId, name: "Tutor", provider: "codex", model: "default" }], topics: [], chats: [first, second] })
  await writeFile(join(directory, "workspace.json"), raw)
  await expect(new WorkspaceRepository(directory).load()).rejects.toThrow()
  expect(await readFile(join(directory, "workspace.json"), "utf8")).toBe(raw)
})

test("persists reusable tutor preferences and honours manual edits and deletion", async () => {
  const store = await repository()
  const path = join(store.directory, "tutor-memory", "behaviour.md")
  await expect(readFile(path)).rejects.toThrow()
  const preferences = "# Tutor preferences\n\n## Explanation and pacing\n\nExplain using the source example first."
  await store.mutate((state) => { state.behaviourMemory = preferences })
  expect(await readFile(path, "utf8")).toBe(preferences)
  const restarted = new WorkspaceRepository(store.directory)
  await restarted.load()
  expect(restarted.stateSnapshot.behaviourMemory).toBe(preferences)
  const edited = preferences + "\nGive one question at a time."
  await writeFile(path, edited)
  await restarted.mutate((state) => { state.runners[0].name = "Renamed tutor" })
  expect(restarted.stateSnapshot.behaviourMemory).toBe(edited)
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.state.behaviourMemory).toBe(edited)
  await rm(path)
  await restarted.refreshTopics()
  expect(restarted.stateSnapshot.behaviourMemory).toBe("")
})

test.each(["# Tutor preferences\n\nUse small steps.", ""])("recovers committed behaviour memory after an interrupted mirror write: %j", async (content) => {
  const store = await repository()
  await store.mutate((state) => { state.behaviourMemory = "Old preferences" })
  const state = store.stateSnapshot
  state.behaviourMemory = content
  new ChatDatabase(join(store.directory, "state.sqlite")).save(state)
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.behaviourMemory).toBe(content)
  const path = join(store.directory, "tutor-memory", "behaviour.md")
  if (content) expect(await readFile(path, "utf8")).toBe(content)
  else await expect(readFile(path)).rejects.toThrow()
  expect(new ChatDatabase(join(store.directory, "state.sqlite")).load()?.filesPending).toBe(false)
})

test("loads existing SQLite workspaces without behaviour memory and imports an existing preference file", async () => {
  const store = await repository()
  const database = new DatabaseSync(join(store.directory, "state.sqlite"))
  database.prepare("UPDATE metadata SET payload = ? WHERE key = 'settings'").run(JSON.stringify({ runners: store.stateSnapshot.runners, providerSettings: [] }))
  database.close()
  expect((await new WorkspaceRepository(store.directory).load()).behaviourMemory).toBe("")
  await mkdir(join(store.directory, "tutor-memory"))
  await writeFile(join(store.directory, "tutor-memory", "behaviour.md"), "Existing reusable preferences")
  const restored = await new WorkspaceRepository(store.directory).load()
  expect(restored.behaviourMemory).toBe("Existing reusable preferences")
})
