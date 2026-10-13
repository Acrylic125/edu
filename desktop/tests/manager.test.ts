import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import {
  WorkerJobSchema,
  TraceEventSchema,
  type WorkerJob,
} from "../src/shared/contracts"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"
import { RunnerManager } from "../src/runners/manager"
import { topicMention } from "../src/shared/topic-mentions"

class ManagedProcess extends EventEmitter {
  pid = 1234
  jobs: WorkerJob[] = []
  killed = false
  postMessage(payload: Parameters<typeof WorkerJobSchema.parse>[0]) {
    this.jobs.push(WorkerJobSchema.parse(payload))
  }
  kill() {
    this.killed = true
    this.emit("exit", 0)
    return true
  }
}
const children: ManagedProcess[] = []
vi.mock("electron", () => ({
  utilityProcess: {
    fork: () => {
      const child = new ManagedProcess()
      children.push(child)
      return child
    },
  },
}))
const directories: string[] = []
const managers: RunnerManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()))
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
  children.splice(0)
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "prune-runners-"))
  directories.push(directory)
  const repository = new WorkspaceRepository(directory)
  await repository.load()
  const firstRunner = repository.stateSnapshot.runners[0]
  const secondRunner = {
    ...firstRunner,
    id: randomUUID(),
    name: "Second tutor",
  }
  const first = newChat(firstRunner.id)
  const second = newChat(secondRunner.id)
  const topic = newTopic("Calculus")
  const other = newTopic("Physics")
  await repository.mutate((state) => {
    state.runners.push(secondRunner)
    state.chats.push(first, second)
    state.topics.push(topic, other)
  })
  const manager = new RunnerManager(
    repository,
    "worker.js",
    "skills",
    async () => ({ apiKey: "key" }),
    () => {},
  )
  managers.push(manager)
  return { manager, repository, first, second, topic, other }
}

test("allows independent runners but rejects overlapping turns on the same runner", async () => {
  const { manager, first, second } = await fixture()
  await Promise.all([
    manager.send({ chatId: first.id, content: "Teach" }),
    manager.send({ chatId: second.id, content: "Teach" }),
  ])
  expect(
    manager.statuses.filter((state) => state.status === "running"),
  ).toHaveLength(2)
  expect(children).toHaveLength(2)
  await expect(
    manager.send({ chatId: first.id, content: "Overlap" }),
  ).rejects.toThrow("already working")
})

test("ignores late results after stop and restarts with the previous saved handoff", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Start" })
  const old = children[0]
  manager.stop(first.runnerId)
  old.emit("message", {
    type: "result",
    reply: "Late lesson",
    learning: first.learning,
  })
  expect(repository.chat(first.id).messages).toHaveLength(1)
  await manager.send({ chatId: first.id, content: "Resume" })
  expect(children[1].jobs[0].chat.learning).toEqual(first.learning)
  expect(
    children[1].jobs[0].chat.messages.map((message) => message.content),
  ).toEqual(["Start", "Resume"])
})

test("marks crashes as errors while preserving the user request for retry", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Explain" })
  children[0].emit("exit", 1)
  expect(
    manager.statuses.find((runtime) => runtime.runnerId === first.runnerId)
      ?.status,
  ).toBe("error")
  expect(repository.chat(first.id).messages[0].content).toBe("Explain")
  await manager.send({ chatId: first.id, content: "Retry" })
  expect(children).toHaveLength(2)
})

test("publishes a reply only after saving the chat handoff", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Help me revise" })
  children[0].emit("message", {
    type: "result",
    reply: "Here is a revision plan.",
    learning: { ...first.learning, workpad: "Revision planned." },
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.chat(first.id).messages.at(-1)?.content).toBe(
    "Here is a revision plan.",
  )
  expect(restored.chat(first.id).learning.workpad).toBe("Revision planned.")
})

test("keeps tagged topics in the chat context and saves only their updates", async () => {
  const { manager, repository, first, topic, other } = await fixture()
  await manager.send({
    chatId: first.id,
    content: `${topicMention(topic.id, topic.title)} Plan this`,
  })
  expect(children[0].jobs[0].topics.map((item) => item.id)).toEqual([topic.id])
  expect(children[0].jobs[0].topics[0].assetDirectory).toBe(
    join(repository.directory, "topics", topic.id, "assets"),
  )
  const planned = { ...topic.learning, outline: ["Limits"], workpad: "Planned." }
  children[0].emit("message", {
    type: "result",
    reply: "Here is your plan.",
    learning: first.learning,
    topicUpdates: [
      { topicId: topic.id, learning: planned },
      { topicId: other.id, learning: planned },
    ],
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  expect(repository.topic(topic.id).learning).toEqual(planned)
  expect(repository.topic(other.id).learning).toEqual(other.learning)
  expect(repository.chat(first.id).messages[0].topicIds).toEqual([topic.id])

  await manager.send({ chatId: first.id, content: "Continue" })
  expect(children[0].jobs[1].topics.map((item) => item.id)).toEqual([topic.id])
})

test("rejects tags for missing topics and confirms only a drafted plan", async () => {
  const { manager, repository, first, topic } = await fixture()
  await expect(
    manager.send({
      chatId: first.id,
      content: `${topicMention(randomUUID(), "Gone")} Teach`,
    }),
  ).rejects.toThrow("no longer exists")
  await expect(
    manager.send({ chatId: first.id, content: "Confirm", confirmTopicId: topic.id }),
  ).rejects.toThrow("no draft plan")
  await repository.mutate((state) => {
    const current = state.topics.find((item) => item.id === topic.id)
    if (current) current.learning.outline = ["Limits"]
  })
  await manager.send({ chatId: first.id, content: "Confirm", confirmTopicId: topic.id })
  expect(repository.topic(topic.id).planConfirmed).toBe(true)
  expect(children[0].jobs[0].confirmTopicId).toBe(topic.id)
  expect(children[0].jobs[0].topics[0].planConfirmed).toBe(true)
})

test("restarts cleanly after a model failure", async () => {
  const { manager, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Explain" })
  children[0].emit("message", { type: "error", error: "Model unavailable" })
  expect(children[0].killed).toBe(true)
  expect(manager.statuses[0].status).toBe("error")
  manager.start(first.runnerId)
  expect(children).toHaveLength(2)
  expect(manager.statuses[0].status).toBe("ready")
})

test("persists failed-turn tool diagnostics with a trace ID and redacts credentials", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Private learner request" })
  children[0].emit("message", {
    type: "trace",
    event: "tool.result",
    details: {
      tool: "save_learning_state",
      success: false,
      error: "phase rejected; Bearer secret-credential",
    },
  })
  children[0].emit("message", { type: "error", error: "Save failed" })
  const runtime = manager.statuses[0]
  expect(runtime.chatId).toBe(first.id)
  expect(runtime.traceId).toBeDefined()
  expect(
    runtime.diagnostics?.find((entry) => entry.event === "tool.result")?.details
      .error,
  ).toContain("<REDACTED>")
  const path = join(
    repository.directory,
    "chats",
    first.id,
    "diagnostics",
    `${runtime.traceId}.jsonl`,
  )
  await vi.waitFor(async () => {
    const raw = await readFile(path, "utf8")
    expect(raw).not.toContain("Private learner request")
    expect(raw).not.toContain("secret-credential")
    const entries = raw
      .trim()
      .split("\n")
      .map((line) => TraceEventSchema.parse(JSON.parse(line)))
    expect(entries.at(-1)?.event).toBe("harness.failed")
    expect(entries.at(-1)?.details.error).toBe("Save failed")
  })
})

test("names the chat and a topic started from it, without replacing either on retry", async () => {
  const { manager, repository, first, topic } = await fixture()
  await manager.send({
    chatId: first.id,
    content: `${topicMention(topic.id, topic.title)} Teach me calculus`,
  })
  children[0].emit("message", { type: "title", title: "Introduction to Calculus" })
  await vi.waitFor(() => expect(repository.chat(first.id).titleGenerated).toBe(true))
  expect(repository.chat(first.id).title).toBe("Introduction to Calculus")
  expect(repository.topic(topic.id).title).toBe("Introduction to Calculus")
  expect(repository.topic(topic.id).learning.notes).toContain("# Introduction to Calculus")
  expect(manager.statuses[0].status).toBe("running")
  children[0].emit("message", { type: "error", error: "Lesson failed" })
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.chat(first.id).title).toBe("Introduction to Calculus")
  await manager.send({ chatId: first.id, content: "Retry" })
  expect(children[1].jobs[0].chat.titleGenerated).toBe(true)
  children[1].emit("message", { type: "title", title: "Another title" })
  await repository.mutate(() => {})
  expect(repository.chat(first.id).title).toBe("Introduction to Calculus")
  expect(repository.topic(topic.id).title).toBe("Introduction to Calculus")
})
