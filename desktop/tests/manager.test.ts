import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

test("commits tutor preferences before the reply and restores them in another chat and provider", async () => {
  const { manager, repository, first, second, other } = await fixture()
  await manager.send({ chatId: first.id, content: "Use small steps for all my lessons." })
  const input = children[0].jobs[0]
  const session = await createTutorSession({ ...input, skillDirectory: resolve("resources/tutor-me") }, () => {})
  const preferences = "# Tutor preferences\n\n## Explanation and pacing\n\nUse small steps."
  expect((await session.execute("save_behaviour_memory", { expected: "", content: preferences })).success).toBe(true)
  await session.execute("save_learning_state", input.chat.learning)
  children[0].emit("message", { type: "result", ...session.finish("I’ll use small steps.") })
  await vi.waitFor(() => expect(manager.statuses.find((runtime) => runtime.runnerId === first.runnerId)?.status).toBe("ready"))
  const restored = await new WorkspaceRepository(repository.directory).load()
  expect(restored.behaviourMemory).toBe(preferences)
  expect(restored.chats.find((chat) => chat.id === first.id)?.messages.at(-1)?.content).toBe("I’ll use small steps.")
  expect(await readFile(join(repository.directory, "tutor-memory", "behaviour.md"), "utf8")).toBe(preferences)
  await repository.mutate((state) => {
    const runner = state.runners.find((runner) => runner.id === second.runnerId)
    if (runner) runner.provider = "openrouter"
  })
  await manager.send({ chatId: second.id, content: `${topicMention(other.id, other.title)} Plan this topic.` })
  expect(children[1].jobs[0]).toMatchObject({ behaviourMemory: preferences, runner: { provider: "openrouter" } })
  const next = await createTutorSession({ ...children[1].jobs[0], skillDirectory: resolve("resources/tutor-me") }, () => {})
  expect(next.instructions).toContain(JSON.stringify(preferences))
})

test("concurrent preference updates reject stale writes without publishing an unsaved reply", async () => {
  const { manager, repository, first, second } = await fixture()
  await manager.send({ chatId: first.id, content: "Explain slowly." })
  await manager.send({ chatId: second.id, content: "Use source examples." })
  children[0].emit("message", {
    type: "result", reply: "I’ll explain slowly.", learning: first.learning,
    behaviourUpdate: { expected: "", content: "Explain slowly." },
  })
  await vi.waitFor(() => expect(manager.statuses.find((runtime) => runtime.runnerId === first.runnerId)?.status).toBe("ready"))
  children[1].emit("message", {
    type: "result", reply: "Preferences saved.", learning: second.learning,
    behaviourUpdate: { expected: "", content: "Use source examples." },
  })
  await vi.waitFor(() => expect(manager.statuses.find((runtime) => runtime.runnerId === second.runnerId)?.error).toContain("preferences changed"))
  expect(repository.stateSnapshot.behaviourMemory).toBe("Explain slowly.")
  expect(repository.chat(second.id).messages.some((message) => message.role === "assistant")).toBe(false)
  await manager.send({ chatId: second.id, content: "Retry with the current preferences." })
  expect(children[1].killed).toBe(true)
  expect(children.at(-1)?.jobs[0].behaviourMemory).toBe("Explain slowly.")
})

test("topic revisions cannot overwrite learner evidence edited while the tutor was working", async () => {
  const { manager, repository, first, topic } = await fixture()
  await manager.send({ chatId: first.id, content: `${topicMention(topic.id, topic.title)} Update my learning need.` })
  const original = children[0].jobs[0].topics[0].learning
  const manual = original.notes + "\n\nOriginal learner attempt added manually."
  await writeFile(join(repository.directory, "topics", topic.id, "topic.md"), manual)
  children[0].emit("message", {
    type: "result", reply: "Updated.", learning: first.learning,
    topicUpdates: [{ topicId: topic.id, expected: original, learning: { ...original, notes: original.notes + "\n\nA stale assessment." } }],
  })
  await vi.waitFor(() => expect(manager.statuses[0].error).toContain("Topic notes changed"))
  expect(repository.topic(topic.id).learning.notes).toBe(manual)
  expect(repository.chat(first.id).messages.some((message) => message.role === "assistant")).toBe(false)
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
  const planned = {
    ...topic.learning,
    outline: ["Limits"],
    notes: `# Calculus\n\n<topic-directory heading="Topic directory" items='[{"title":"Limits"}]' />`,
    workpad: "Planned.",
  }
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
    if (current) current.learning.notes = `# Calculus\n\n<topic-directory heading="Topic directory" items='[{"title":"Limits"}]' />`
  })
  await manager.send({ chatId: first.id, content: "Confirm", confirmTopicId: topic.id })
  expect(repository.topic(topic.id).planConfirmed).toBe(true)
  expect(children[0].jobs[0].confirmTopicId).toBe(topic.id)
  expect(children[0].jobs[0].topics[0].planConfirmed).toBe(true)
})

test("passes the open topic and its saved progress to the worker without modifying the learner's message", async () => {
  const { manager, repository, first, topic } = await fixture()
  await repository.mutate((state) => {
    const current = state.topics.find((item) => item.id === topic.id)
    if (!current) throw new Error("Missing fixture topic")
    current.learning.nextAction = "Explain derivatives next."
  })
  await manager.send({ chatId: first.id, content: "What is next?", openedTopicId: topic.id })
  const job = children[0].jobs[0]
  expect(job.openedTopicId).toBe(topic.id)
  expect(job.topics.map((item) => item.id)).toEqual([topic.id])
  expect(job.topics[0].learning.nextAction).toBe("Explain derivatives next.")
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
    suggestion, undefined, expect.any(Function), expect.any(Function),
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
