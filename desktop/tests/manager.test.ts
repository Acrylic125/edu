import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import {
  WorkerJobSchema,
  TraceEventSchema,
  type WorkerJob,
} from "../src/shared/contracts"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"
import { RunnerManager } from "../src/runners/manager"
import { topicMention } from "../src/shared/topic-mentions"
import * as titles from "../src/runners/title"
import { createTutorSession } from "../src/runners/tutor"
import { StateService } from "../src/main/state-service"
import { TurnTelemetry } from "../src/runners/telemetry"

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
  vi.restoreAllMocks()
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

test("allows independent runners but rejects overlapping turns on the same chat", async () => {
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

test("runs chats sharing a runner concurrently and saves each reply to its own chat", async () => {
  const { manager, repository, first } = await fixture()
  const second = newChat(first.runnerId)
  await repository.mutate((state) => state.chats.push(second))
  await Promise.all([
    manager.send({ chatId: first.id, content: "Teach calculus" }),
    manager.send({ chatId: second.id, content: "Teach physics" }),
  ])
  expect(manager.statuses.filter((state) => state.status === "running").map((state) => state.chatId).sort()).toEqual([first.id, second.id].sort())
  await expect(manager.send({ chatId: first.id, content: "Overlap" })).rejects.toThrow("already working")
  for (const [index, child] of children.entries()) {
    const job = child.jobs[0]
    child.emit("message", { type: "result", reply: `Reply ${index + 1}`, learning: job.chat.learning })
  }
  await vi.waitFor(() => expect(manager.statuses.filter((state) => state.runnerId === first.runnerId).every((state) => state.status === "ready")).toBe(true))
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  for (const [index, child] of children.entries()) {
    expect(restored.chat(child.jobs[0].chat.id).messages.at(-1)?.content).toBe(`Reply ${index + 1}`)
  }
})

test("passes runtime-relative Phoenix context to workers and closes stopped turns", async () => {
  const finish = vi.spyOn(TurnTelemetry.prototype, "finish")
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Teach" })
  const job = children[0].jobs[0]
  expect(job.telemetry?.directory).toBe(join(repository.directory, "phoenix"))
  expect(job.telemetry?.parent.traceId).toMatch(/^[a-f0-9]{32}$/)
  manager.stop(first.runnerId)
  expect(finish).toHaveBeenCalledWith(true)
})

test.each(["stop", "crash", "error"] as const)("isolates a chat %s from another chat sharing its runner", async (failure) => {
  const { manager, repository, first } = await fixture()
  const second = newChat(first.runnerId)
  await repository.mutate((state) => state.chats.push(second))
  await manager.send({ chatId: first.id, content: "First request" })
  await manager.send({ chatId: second.id, content: "Second request" })
  if (failure === "stop") manager.stop(first.runnerId, first.id)
  else if (failure === "crash") children[0].emit("exit", 1)
  else children[0].emit("message", { type: "error", error: "Model failed" })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === first.id)?.status).toBe(failure === "stop" ? "stopped" : "error"))
  expect(manager.statuses.find((state) => state.chatId === second.id)?.status).toBe("running")
  children[0].emit("message", { type: "result", reply: "Late reply", learning: first.learning })
  children[1].emit("message", { type: "result", reply: "Second reply", learning: second.learning })
  await vi.waitFor(() => expect(repository.chat(second.id).messages.at(-1)?.content).toBe("Second reply"))
  expect(repository.chat(first.id).messages.map((message) => message.content)).toEqual(["First request"])
})

test("stops all chats for runner-wide operations", async () => {
  const { manager, repository, first } = await fixture()
  const second = newChat(first.runnerId)
  await repository.mutate((state) => state.chats.push(second))
  await manager.send({ chatId: first.id, content: "First" })
  await manager.send({ chatId: second.id, content: "Second" })
  manager.stop(first.runnerId)
  expect(manager.statuses.filter((state) => state.runnerId === first.runnerId).map((state) => state.status)).toEqual(["stopped", "stopped"])
  expect(children.every((child) => child.killed)).toBe(true)
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

test("stale topic summary writes cannot replace newer manual edits or publish a reply", async () => {
  const { manager, repository, first, topic } = await fixture()
  await manager.send({ chatId: first.id, content: `${topicMention(topic.id, topic.title)} Update the summary.` })
  const original = children[0].jobs[0].topics[0].learning.notes
  const manual = original + "\n\nNewer conceptual explanation."
  await writeFile(join(repository.directory, "topics", topic.id, "topic.md"), manual)
  children[0].emit("message", {
    type: "result", reply: "Updated.", learning: first.learning,
    topicMutations: [{ type: "updateTopic", topicId: topic.id, expectedSummary: original, summary: "Stale summary." }],
  })
  await vi.waitFor(() => expect(manager.statuses[0].error).toContain("Topic summary changed"))
  expect(repository.topic(topic.id).learning.notes).toBe(manual)
  expect(repository.chat(first.id).messages.some((message) => message.role === "assistant")).toBe(false)
})

test("keeps tagged topics in context and rejects mutations to read-only topics atomically", async () => {
  const { manager, repository, first, topic, other } = await fixture()
  await manager.send({ chatId: first.id, content: `${topicMention(topic.id, topic.title)} Plan this` })
  expect(children[0].jobs[0].topics.map((item) => item.id)).toEqual([topic.id])
  children[0].emit("message", {
    type: "result", reply: "Here is your plan.", learning: first.learning,
    topicMutations: [
      { type: "updateTopic", topicId: topic.id, summary: "A conceptual summary." },
      { type: "updateTopic", topicId: other.id, summary: "An unauthorized summary." },
    ],
  })
  await vi.waitFor(() => expect(manager.statuses[0].error).toContain("Only tagged"))
  expect(repository.topic(topic.id).learning.notes).toBe(topic.learning.notes)
  expect(repository.topic(other.id).learning.notes).toBe(other.learning.notes)
  expect(repository.chat(first.id).messages).toHaveLength(1)
  await manager.send({ chatId: first.id, content: "Continue" })
  expect(children[1].jobs[0].topics.map((item) => item.id)).toEqual([topic.id])
})

test("concurrent chats sharing a runner merge per-thread progress and mistakes into the same topic", async () => {
  const { StateService } = await import("../src/main/state-service")
  const { manager, repository, first, second, topic } = await fixture()
  await repository.mutate((state) => {
    const chat = state.chats.find((chat) => chat.id === second.id)
    if (chat) chat.runnerId = first.runnerId
  })
  await new StateService(repository, first.id).updateTopic(topic.id, { content: [{ id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Explain approaching"] }, mistakes: [] }] })
  await repository.mutate((state) => { state.topics[0].planConfirmed = true })
  await Promise.all([
    manager.send({ chatId: first.id, content: `${topicMention(topic.id, topic.title)} Continue` }),
    manager.send({ chatId: second.id, content: `${topicMention(topic.id, topic.title)} Practice` }),
  ])
  for (const [index, chat] of [first, second].entries()) {
    children[index].emit("message", {
      type: "result", reply: "Question?", learning: chat.learning,
      topicMutations: [
        { type: "activatePart", topicId: topic.id, topicPartId: "tp-limits" },
        { type: "recordQuestion", topicId: topic.id, topicPartId: "tp-limits", question: `Question ${index + 1}?` },
        { type: "documentMistake", topicId: topic.id, topicPartId: "tp-limits", context: `Earlier attempt ${index + 1}`, issue: `Confirmed mistake ${index + 1}` },
      ],
    })
  }
  await vi.waitFor(() => expect(manager.statuses.filter((status) => status.runnerId === first.runnerId).every((status) => status.status === "ready")).toBe(true), { timeout: 5_000 })
  const reloaded = new WorkspaceRepository(repository.directory)
  await reloaded.load()
  const state = reloaded.topic(topic.id).state
  expect(state?.threadTutors).toHaveLength(2)
  expect(state?.content[0].mistakes).toHaveLength(2)
  expect(state?.threadTutors.map((thread) => thread.progress["tp-limits"].steps[0].question).sort()).toEqual(["Question 1?", "Question 2?"])
  expect(reloaded.chat(first.id).messages.at(-1)?.content).toBe("Question?")
  expect(reloaded.chat(second.id).messages.at(-1)?.content).toBe("Question?")
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
  await new StateService(repository, first.id).updateTopic(topic.id, { content: [{
    id: "tp-limits", name: "Limits", references: [], mistakes: [],
    goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Distinguish limit and value"] },
  }] })
  await manager.send({ chatId: first.id, content: "Confirm", confirmTopicId: topic.id })
  expect(repository.topic(topic.id).planConfirmed).toBe(true)
  expect(children[0].jobs[0].confirmTopicId).toBe(topic.id)
  expect(children[0].jobs[0].topics[0].planConfirmed).toBe(true)
})

test("passes the open topic and its saved progress to the worker without modifying the learner's message", async () => {
  const { manager, repository, first, topic } = await fixture()
  const service = new StateService(repository, first.id)
  await service.updateTopic(topic.id, { content: [{
    id: "tp-derivatives", name: "Derivatives", references: [], mistakes: [],
    goals: { id: "tpg-derivatives", objective: "Explain derivatives", understoodWhen: ["Justify the limit"] },
  }] })
  await service.activatePart(topic.id, "tp-derivatives")
  await service.recordQuestion(topic.id, "tp-derivatives", "What does a derivative measure?")
  await manager.send({ chatId: first.id, content: "What is next?", openedTopicId: topic.id })
  const job = children[0].jobs[0]
  expect(job.openedTopicId).toBe(topic.id)
  expect(job.topics.map((item) => item.id)).toEqual([topic.id])
  expect(job.topics[0].state?.threadTutors).toEqual([{ id: first.id, progress: { "tp-derivatives": { status: "active", steps: [{ question: "What does a derivative measure?" }] } } }])
  expect(repository.chat(first.id).messages[0].content).toBe("What is next?")
  expect(repository.chat(first.id).messages[0].topicIds).toEqual([topic.id])
  expect(repository.topic(topic.id).planConfirmed).toBe(false)
})

test("keeps explicit topic mentions alongside the current open topic", async () => {
  const { manager, first, topic, other } = await fixture()
  await manager.send({
    chatId: first.id,
    content: `${topicMention(other.id, other.title)} Compare this with the open topic`,
    openedTopicId: topic.id,
  })
  expect(children[0].jobs[0].openedTopicId).toBe(topic.id)
  expect(children[0].jobs[0].topics.map((item) => item.id)).toEqual(expect.arrayContaining([topic.id, other.id]))
  expect(children[0].jobs[0].topics).toHaveLength(2)
})

test("rejects a missing open topic before saving a message or starting a worker", async () => {
  const { manager, repository, first } = await fixture()
  await expect(manager.send({ chatId: first.id, content: "Continue", openedTopicId: randomUUID() }))
    .rejects.toThrow("This topic no longer exists")
  expect(repository.chat(first.id).messages).toHaveLength(0)
  expect(children).toHaveLength(0)
})

test("restarts cleanly after a model failure", async () => {
  const { manager, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Explain" })
  children[0].emit("message", { type: "error", error: "Model unavailable" })
  expect(children[0].killed).toBe(true)
  expect(manager.statuses[0].status).toBe("error")
  manager.start(first.runnerId, first.id)
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

test("names the chat without renaming its tagged topic, including on retry", async () => {
  const { manager, repository, first, topic } = await fixture()
  await manager.send({
    chatId: first.id,
    content: `${topicMention(topic.id, topic.title)} Teach me calculus`,
  })
  children[0].emit("message", { type: "title", title: "Introduction to Calculus" })
  await vi.waitFor(() => expect(repository.chat(first.id).titleGenerated).toBe(true))
  expect(repository.chat(first.id).title).toBe("Introduction to Calculus")
  expect(repository.topic(topic.id).title).toBe("Calculus")
  expect(repository.topic(topic.id).learning.notes).toContain("# Calculus")
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
  expect(repository.topic(topic.id).title).toBe("Calculus")
})

test("generates a topic title from the suggestion before persisting it", async () => {
  const { manager, repository, second } = await fixture()
  let finish = (_title: string) => {}
  const generation = vi.spyOn(titles, "generateTopicTitle").mockImplementation(
    () => new Promise<string>((resolve) => { finish = resolve }),
  )
  const suggestion = "Help me learn calculus, starting with limits and derivatives."
  const creation = manager.createTopic({ title: suggestion, runnerId: second.runnerId })
  await vi.waitFor(() => expect(generation).toHaveBeenCalled())
  expect(repository.stateSnapshot.topics).toHaveLength(2)
  expect(generation).toHaveBeenCalledWith(
    expect.objectContaining({ runner: expect.objectContaining({ id: second.runnerId }) }),
    suggestion, expect.any(Function), expect.any(Function),
  )
  finish("Introduction to Calculus")
  const id = await creation
  expect(repository.topic(id)).toMatchObject({ title: "Introduction to Calculus", titleGenerated: true })
  expect(await readFile(join(repository.directory, "topics", id, "topic.md"), "utf8")).toMatch(/^# Introduction to Calculus\n/)
  expect((await new WorkspaceRepository(repository.directory).load()).topics.find((topic) => topic.id === id)?.title).toBe("Introduction to Calculus")
})

test("does not create a topic when naming fails and allows retry", async () => {
  const { manager, repository } = await fixture()
  const generation = vi.spyOn(titles, "generateTopicTitle")
    .mockRejectedValueOnce(new Error("Naming failed"))
    .mockResolvedValueOnce("Introduction to Geometry")
  await expect(manager.createTopic({ title: "Teach me geometry" })).rejects.toThrow("Naming failed")
  expect(repository.stateSnapshot.topics).toHaveLength(2)
  await expect(manager.createTopic({ title: "Teach me geometry" })).resolves.toBeDefined()
  expect(generation).toHaveBeenCalledTimes(2)
  await expect(manager.createTopic({ title: "Geometry", runnerId: randomUUID() })).rejects.toThrow("Runner not found")
})


test("marks a native session pending before dispatch and commits its binding with the reply", async () => {
  const { manager, repository, first } = await fixture()
  const session = { provider: "codex" as const, threadId: "native-thread", home: "/private/codex", executable: "/bundled/codex", toolVersion: 1 as const, status: "ready" as const }
  await repository.mutate((state) => { state.chats[0].providerSession = session })
  await manager.send({ chatId: first.id, content: "Continue" })
  expect(children[0].jobs[0].chat.providerSession).toEqual(session)
  expect(repository.chat(first.id).providerSession?.status).toBe("pending")
  const before = await new WorkspaceRepository(repository.directory).load()
  expect(before.chats.find((chat) => chat.id === first.id)?.providerSession?.status).toBe("pending")
  children[0].emit("message", { type: "result", reply: "A committed reply.", learning: first.learning, providerSession: session })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  const after = await new WorkspaceRepository(repository.directory).load()
  expect(after.chats.find((chat) => chat.id === first.id)?.providerSession).toEqual(session)
  expect(after.chats.find((chat) => chat.id === first.id)?.messages.at(-1)?.content).toBe("A committed reply.")
  expect(repository.publicChats[0]).not.toHaveProperty("providerSession")
})

test("keeps interrupted native sessions pending across restart", async () => {
  const { manager, repository, first } = await fixture()
  await repository.mutate((state) => { state.chats[0].providerSession = { provider: "codex", threadId: "native-thread", home: "/private/codex", executable: "/bundled/codex", toolVersion: 1, status: "ready" } })
  await manager.send({ chatId: first.id, content: "Interrupted" })
  manager.stop(first.runnerId)
  await manager.send({ chatId: first.id, content: "Retry" })
  expect(children[1].jobs[0].chat.providerSession?.status).toBe("pending")
  expect((await new WorkspaceRepository(repository.directory).load()).chats.find((chat) => chat.id === first.id)?.providerSession?.status).toBe("pending")
})

test("retrieves past learner mistakes from untagged topics without exposing their private handoffs", async () => {
  const { manager, repository, first, topic, other } = await fixture()
  const evidence = "# Physics\n\n## Check P1\nQuestion: Explain acceleration.\nLearner answer: Acceleration is speed.\nDeliberation: Confused speed with change in velocity.\n\nCurrent difficulty: resolved after an independent retry."
  await repository.mutate((state) => {
    const saved = state.topics.find((item) => item.id === other.id)
    if (!saved) throw new Error("Missing fixture topic")
    saved.learning.notes = evidence
    saved.learning.privateAnswerKey = "PRIVATE_UNANSWERED_PHYSICS_KEY"
    saved.archived = true
  })
  await manager.send({ chatId: first.id, content: `${topicMention(topic.id, topic.title)} Across all topics, what are the past mistakes I have made?` })
  const input = children[0].jobs[0]
  expect(input.topics.map((item) => item.id)).toEqual([topic.id])
  const session = await createTutorSession({ ...input, skillDirectory: resolve("resources/tutor-me") }, () => {})
  const referenceHandle = `topic_${input.chat.topicHandles.indexOf(other.id) + 1}`
  const result = await session.execute("read_topic_notes", { topicId: referenceHandle })
  expect(result.success).toBe(true)
  expect(result.text).toContain(JSON.stringify(evidence))
  expect(result.text).not.toContain("PRIVATE_UNANSWERED_PHYSICS_KEY")
  expect(session.instructions).toContain(referenceHandle)
  expect(session.instructions).not.toContain(evidence)
  expect((await session.execute("save_topic_state", { topicId: other.id, learning: other.learning })).success).toBe(false)
})

test("a topic created by tutor tools stays writable in the originating chat on follow-up turns", async () => {
  const { manager, repository, first } = await fixture()
  await manager.send({ chatId: first.id, content: "Create a prerequisite topic for algebra." })
  const topicId = randomUUID()
  children[0].emit("message", {
    type: "result", reply: "Created Algebra.", learning: first.learning,
    topicMutations: [{ type: "createTopic", topicId, topic: { version: "11-10-2026", name: "Algebra", content: [] } }],
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  expect(repository.chat(first.id).messages.at(-1)?.topicIds).toEqual([topicId])
  expect(repository.chat(first.id).topicHandles).toContain(topicId)
  await manager.send({ chatId: first.id, content: "Add linear equations to its curriculum." })
  expect(children[0].jobs[1].topics.map((topic) => topic.id)).toContain(topicId)
  children[0].emit("message", {
    type: "result", reply: "Added the curriculum.", learning: first.learning,
    topicMutations: [{ type: "updateTopic", topicId, content: [{ id: "tp-equations", name: "Linear equations", references: [], goals: { id: "tpg-equations", objective: "Solve linear equations", understoodWhen: ["Justify equivalent operations"] }, mistakes: [] }] }],
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  expect(repository.topic(topicId).state?.content[0].name).toBe("Linear equations")
})

test("topic handles survive reloads and directory reordering as new reference topics appear", async () => {
  const { manager, repository, first, topic, other } = await fixture()
  await manager.send({ chatId: first.id, content: topicMention(topic.id, topic.title) })
  const original = children[0].jobs[0].chat.topicHandles
  expect(new Set(original)).toEqual(new Set([topic.id, other.id]))
  children[0].emit("message", { type: "result", reply: "Ready", learning: first.learning })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  const reloaded = new WorkspaceRepository(repository.directory)
  await reloaded.load()
  expect(reloaded.chat(first.id).topicHandles).toEqual(original)
  const extra = newTopic("Geometry")
  await repository.mutate((state) => { state.topics.reverse(); state.topics.unshift(extra) })
  await manager.send({ chatId: first.id, content: "Use Geometry as a reference" })
  expect(children[0].jobs[1].chat.topicHandles).toEqual([...original, extra.id])
  const session = await createTutorSession({ ...children[0].jobs[1], skillDirectory: resolve("resources/tutor-me") }, () => {})
  const reference = await session.execute("read_topic_notes", { topicId: `topic_${original.indexOf(other.id) + 1}` })
  expect(JSON.parse(reference.text)).toMatchObject({ title: other.title })
})

test("worker topic directories use the same snapshot as persisted handles during concurrent topic creation", async () => {
  const { manager, repository, first } = await fixture()
  const concurrent = newTopic("Concurrent reference")
  const mutate = repository.mutate.bind(repository)
  vi.spyOn(repository, "mutate").mockImplementationOnce(async (update) => {
    await mutate(update)
    await mutate((state) => { state.topics.unshift(concurrent) })
  })
  await manager.send({ chatId: first.id, content: "Create a prerequisite topic" })
  const job = children[0].jobs[0]
  expect(job.workspaceTopics.every((topic) => job.chat.topicHandles.includes(topic.id))).toBe(true)
  expect(repository.chat(first.id).topicHandles).toEqual(job.chat.topicHandles)
})

test.each(["chat", "topic"] as const)("topics created from %s sources retain readable local references in a new chat", async (owner) => {
  const { copyFile, mkdir } = await import("node:fs/promises")
  const { manager, repository, first, topic } = await fixture()
  const material = { id: randomUUID(), name: "limits.pdf", kind: "pdf" as const, text: "Limits source", pages: ["Limits source"] }
  const sourceDirectory = join(repository.directory, owner === "chat" ? "chats" : "topics", owner === "chat" ? first.id : topic.id, "assets")
  await mkdir(sourceDirectory, { recursive: true })
  await copyFile(resolve("tests/fixtures/limits.pdf"), join(sourceDirectory, material.name))
  await repository.mutate((state) => {
    if (owner === "chat") state.chats[0].materials.push(material)
    else state.topics.find((item) => item.id === topic.id)?.materials.push(material)
  })
  const content = owner === "topic" ? `${topicMention(topic.id, topic.title)} Create a source-based topic.` : "Create a source-based topic."
  await manager.send({ chatId: first.id, content })
  const topicId = randomUUID()
  children[0].emit("message", {
    type: "result", reply: "Created Source Limits.", learning: first.learning,
    topicMutations: [{ type: "createTopic", topicId, topic: { version: "11-10-2026", name: "Source Limits", content: [{ id: "tp-source", name: "Source Limits", references: [{ type: "pdf", path: "assets/limits.pdf", pages: [{ from: 1, to: 1 }] }], goals: { id: "tpg-source", objective: "Explain limits", understoodWhen: ["Explain approaching"] }, mistakes: [] }] } }],
  })
  await vi.waitFor(() => expect(manager.statuses[0].status).toBe("ready"))
  expect(repository.topic(topicId).materials).toEqual([material])
  expect(await readFile(join(repository.directory, "topics", topicId, "assets", material.name))).toEqual(await readFile(resolve("tests/fixtures/limits.pdf")))
  const chat = newChat(first.runnerId)
  await repository.mutate((state) => state.chats.push(chat))
  await manager.send({ chatId: chat.id, content: `${topicMention(topicId, "Source Limits")} Read the source.` })
  const session = await createTutorSession({ ...children[1].jobs[0], skillDirectory: resolve("resources/tutor-me") }, () => {})
  const result = await session.execute("read_material", { id: material.id, firstPage: 1, lastPage: 1 })
  expect(result.success).toBe(true)
  expect(result.text).toContain("Limits source")
})


test("persists each response's generation duration independently across concurrent chats", async () => {
  const { manager, repository, first, second } = await fixture()
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000)
  await manager.send({ chatId: first.id, content: "First question" })
  clock.mockReturnValue(2000)
  await manager.send({ chatId: second.id, content: "Second question" })
  clock.mockReturnValue(4500)
  children[1].emit("message", { type: "result", reply: "Second reply", learning: second.learning })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === second.id)?.status).toBe("ready"))
  clock.mockReturnValue(6000)
  children[0].emit("message", { type: "result", reply: "First reply", learning: first.learning })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === first.id)?.status).toBe("ready"))
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.chat(first.id).messages.at(-1)).toMatchObject({ durationMs: 5000 })
  expect(restored.chat(second.id).messages.at(-1)).toMatchObject({ durationMs: 2500 })
  expect(restored.chat(first.id).messages[0]).not.toHaveProperty("durationMs")
})

test("streams into the correct chat without persisting drafts and clears failed replies", async () => {
  const { manager, repository, first, second } = await fixture()
  await manager.send({ chatId: first.id, content: "Teach" })
  await manager.send({ chatId: second.id, content: "Teach" })
  children[0].emit("message", { type: "reply", text: "Partial lesson" })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === first.id)).toMatchObject({ reply: "Partial lesson", status: "running" }))
  expect(manager.statuses.find((state) => state.chatId === second.id)).not.toHaveProperty("reply")
  expect(repository.chat(first.id).messages.some((message) => message.role === "assistant")).toBe(false)
  children[0].emit("message", { type: "reply", text: "" })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === first.id)).toMatchObject({ reply: "" }))
  children[0].emit("message", { type: "reply", text: "Replacement" })
  children[0].emit("message", { type: "error", error: "Interrupted" })
  await vi.waitFor(() => expect(manager.statuses.find((state) => state.chatId === first.id)).toMatchObject({ status: "error" }))
  expect(manager.statuses.find((state) => state.chatId === first.id)).not.toHaveProperty("reply")
})

test("persists response choices with their assistant message without carrying them into later replies", async () => {
  const { manager, repository, first } = await fixture()
  const responseQuestion = { prompt: "What would you like to do next?", options: ["Continue", "Quick practice"] }
  await manager.send({ chatId: first.id, content: "My summary of the part." })
  children[0].emit("message", {
    type: "result", reply: "Your explanation meets the part's goals.",
    learning: { ...first.learning, phase: "awaiting_choice", responseQuestion },
  })
  await vi.waitFor(() => expect(repository.chat(first.id).messages.at(-1)?.role).toBe("assistant"))
  const reloaded = new WorkspaceRepository(repository.directory)
  await reloaded.load()
  expect(reloaded.chat(first.id).messages.at(-1)).toMatchObject({ responseQuestion })
  expect(reloaded.publicChats.find((chat) => chat.id === first.id)?.messages.at(-1)).toMatchObject({ responseQuestion })
  await manager.send({ chatId: first.id, content: "Quick practice" })
  expect(children.at(-1)?.jobs.at(-1)?.chat.messages.at(-1)?.content).toBe("Quick practice")
  children.at(-1)?.emit("message", { type: "result", reply: "Here is a practice question.", learning: first.learning })
  await vi.waitFor(() => expect(repository.chat(first.id).messages.at(-1)?.content).toBe("Here is a practice question."))
  expect(repository.chat(first.id).messages.at(-1)).not.toHaveProperty("responseQuestion")
})

test("keeps newly attached images on their user message across reload without repeating them", async () => {
  const { manager, repository, first } = await fixture()
  const firstImage = { id: randomUUID(), name: "first.png", kind: "image" as const, text: "Image source", pages: [] }
  const secondImage = { ...firstImage, id: randomUUID(), name: "second.png" }
  await repository.mutate((state) => state.chats[0].materials.push(firstImage))
  await manager.send({ chatId: first.id, content: "Explain the first image" })
  expect(repository.chat(first.id).messages[0]).toMatchObject({ materialIds: [firstImage.id] })
  manager.stop(first.runnerId, first.id)
  await repository.mutate((state) => state.chats[0].materials.push(secondImage))
  await manager.send({ chatId: first.id, content: "Now explain the second image" })
  expect(repository.chat(first.id).messages[1]).toMatchObject({ materialIds: [secondImage.id] })
  const restored = new WorkspaceRepository(repository.directory)
  await restored.load()
  expect(restored.chat(first.id).messages.map((message) => message.materialIds)).toEqual([[firstImage.id], [secondImage.id]])
})

test("preserves explicitly submitted topic images and rejects images outside the chat context", async () => {
  const { manager, repository, first, second, topic } = await fixture()
  const image = { id: randomUUID(), name: "topic.png", kind: "image" as const, text: "Image source", pages: [] }
  const assets = join(repository.directory, "topics", topic.id, "assets")
  await mkdir(assets, { recursive: true })
  await writeFile(join(assets, image.name), await readFile(resolve("src/renderer/assets/app-icon.png")))
  await repository.mutate((state) => state.topics.find((item) => item.id === topic.id)!.materials.push(image))
  await expect(manager.send({ chatId: second.id, content: "Invalid attachment", materialIds: [image.id] })).rejects.toThrow("not available in this chat")
  expect(repository.chat(second.id).messages).toHaveLength(0)
  await manager.send({ chatId: first.id, content: "Explain this topic image", openedTopicId: topic.id, materialIds: [image.id] })
  expect(repository.chat(first.id).messages[0]).toMatchObject({ materialIds: [image.id], topicIds: [topic.id] })
  await manager.send({ chatId: second.id, content: `${topicMention(topic.id, topic.title)} Retry the image request` })
  expect(repository.chat(second.id).messages[0]).toMatchObject({ materialIds: [image.id], topicIds: [topic.id] })
})
