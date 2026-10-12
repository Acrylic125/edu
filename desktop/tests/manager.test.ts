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
import { newTopic, WorkspaceRepository } from "../src/main/workspace"
import { RunnerManager } from "../src/runners/manager"

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
  const first = newTopic("First topic", firstRunner.id)
  const second = newTopic("Second topic", secondRunner.id)
  await repository.mutate((state) => {
    state.runners.push(secondRunner)
    state.topics.push(first, second)
  })
  const manager = new RunnerManager(
    repository,
    "worker.js",
    "skills",
    async () => ({ apiKey: "key" }),
    () => {},
  )
  managers.push(manager)
  return { manager, repository, first, second }
}

test("allows independent runners but rejects overlapping turns on the same runner", async () => {
  const { manager, first, second } = await fixture()
  await Promise.all([
    manager.send({ topicId: first.id, content: "Teach", action: "message" }),
    manager.send({ topicId: second.id, content: "Teach", action: "message" }),
  ])
  expect(
    manager.statuses.filter((state) => state.status === "running"),
  ).toHaveLength(2)
  expect(children).toHaveLength(2)
  await expect(
    manager.send({ topicId: first.id, content: "Overlap", action: "message" }),
  ).rejects.toThrow("already working")
})

test("ignores late results after stop and restarts with the previous saved handoff", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ topicId: first.id, content: "Start", action: "message" })
  const old = children[0]
  manager.stop(first.runnerId)
  old.emit("message", {
    type: "result",
    reply: "Late lesson",
    learning: first.learning,
  })
  expect(repository.topic(first.id).messages).toHaveLength(1)
  await manager.send({
    topicId: first.id,
    content: "Resume",
    action: "message",
  })
  expect(children[1].jobs[0].topic.learning).toEqual(first.learning)
  expect(
    children[1].jobs[0].topic.messages.map((message) => message.content),
  ).toEqual(["Start", "Resume"])
})

test("marks crashes as errors while preserving the user request for retry", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({
    topicId: first.id,
    content: "Explain",
    action: "message",
  })
  children[0].emit("exit", 1)
  expect(
    manager.statuses.find((runtime) => runtime.runnerId === first.runnerId)
      ?.status,
  ).toBe("error")
  expect(repository.topic(first.id).messages[0].content).toBe("Explain")
  await manager.send({ topicId: first.id, content: "Retry", action: "message" })
  expect(children).toHaveLength(2)
})

test("publishes a lesson only after saving its notes and private handoff", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({
    topicId: first.id,
    content: "Propose a plan",
    action: "message",
  })
  children[0].emit("message", {
    type: "result",
    reply: "Here is your draft plan.",
    learning: { ...first.learning, outline: ["Section 1"] },
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.topic(first.id).messages.at(-1)?.content).toBe(
    "Here is your draft plan.",
  )
  expect(restored.topic(first.id).learning.outline).toEqual(["Section 1"])
})

test("restarts cleanly after a model failure", async () => {
  const { manager, first } = await fixture()
  await manager.send({
    topicId: first.id,
    content: "Explain",
    action: "message",
  })
  children[0].emit("message", { type: "error", error: "Model unavailable" })
  expect(children[0].killed).toBe(true)
  expect(manager.statuses[0].status).toBe("error")
  manager.start(first.runnerId)
  expect(children).toHaveLength(2)
  expect(manager.statuses[0].status).toBe("ready")
})

test("persists failed-turn tool diagnostics with a trace ID and redacts credentials", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({
    topicId: first.id,
    content: "Private learner request",
    action: "message",
  })
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
  expect(runtime.topicId).toBe(first.id)
  expect(runtime.traceId).toBeDefined()
  expect(
    runtime.diagnostics?.find((entry) => entry.event === "tool.result")?.details
      .error,
  ).toContain("<REDACTED>")
  const path = join(
    repository.directory,
    "topics",
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

test("persists a generated title even if the lesson fails, without replacing it on retry", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ topicId: first.id, content: "Teach me calculus", action: "message" })
  children[0].emit("message", { type: "title", title: "Introduction to Calculus" })
  await vi.waitFor(() => expect(repository.topic(first.id).titleGenerated).toBe(true))
  expect(repository.topic(first.id).learning.notes).toContain("# Introduction to Calculus")
  expect(manager.statuses[0].status).toBe("running")
  children[0].emit("message", { type: "error", error: "Lesson failed" })
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.topic(first.id).title).toBe("Introduction to Calculus")
  await manager.send({ topicId: first.id, content: "Retry", action: "message" })
  expect(children[1].jobs[0].topic.titleGenerated).toBe(true)
  children[1].emit("message", { type: "title", title: "Another title" })
  await repository.mutate(() => {})
  expect(repository.topic(first.id).title).toBe("Introduction to Calculus")
})
