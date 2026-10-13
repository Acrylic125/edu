import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { newTopic, WorkspaceRepository } from "../src/main/workspace"

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
  const original = await readFile(
    join(store.directory, "workspace.json"),
    "utf8",
  )
  await expect(
    store.mutate((state) => (state.runners[0].name = "")),
  ).rejects.toThrow()
  expect(await readFile(join(store.directory, "workspace.json"), "utf8")).toBe(
    original,
  )
  await store.mutate((state) => (state.runners[0].name = "Recovered"))
  expect(store.stateSnapshot.runners[0].name).toBe("Recovered")
})

test("migrates per-topic conversations into independent chats and keeps the original file", async () => {
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
  expect(await readFile(join(directory, "workspace.v1.json"), "utf8")).toBe(legacy)
})

test("does not replace a corrupt workspace with an empty one", async () => {
  const store = await repository()
  await writeFile(join(store.directory, "workspace.json"), "invalid json")
  await expect(
    new WorkspaceRepository(store.directory).load(),
  ).rejects.toThrow()
  expect(await readFile(join(store.directory, "workspace.json"), "utf8")).toBe(
    "invalid json",
  )
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
