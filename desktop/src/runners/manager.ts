import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { utilityProcess } from "electron"
import OpenAI from "openai"
import { z } from "zod"
import {
  WorkerEventSchema,
  type RuntimeSchema,
  type SendSchema,
  type RunnerSchema,
  type WorkerJob,
  type CreateTopicSchema,
} from "../shared/contracts"
import { parseTopicMentions, stripTopicMentions } from "../shared/topic-mentions"
import { newTopic, WorkspaceRepository } from "../main/workspace"
import { generateTopicTitle } from "./title"
import { TurnTrace } from "./trace"

export class RunnerManager {
  private codexProcesses = new Map<string, number>()
  private processes = new Map<string, Electron.UtilityProcess>()
  private runtime = new Map<string, z.infer<typeof RuntimeSchema>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private locks = new Set<string>()
  private committing = new Set<string>()
  private traces = new Map<string, { chatId: string; trace: TurnTrace }>()

  constructor(
    private repository: WorkspaceRepository,
    private workerPath: string,
    private skillDirectory: string,
    private getConnection: (
      runner: z.infer<typeof RunnerSchema>,
    ) => Promise<Pick<WorkerJob, "apiKey" | "codex" | "cli" | "titleModel">>,
    private notify: () => void,
  ) {}

  get statuses() {
    return this.repository.stateSnapshot.runners.map((runner) => {
      const runtime = this.runtime.get(runner.id) ?? {
        runnerId: runner.id,
        status: "stopped" as const,
        activity: "Starts automatically when you send a message",
      }
      const diagnostic = this.traces.get(runner.id)
      if (!diagnostic) return runtime
      return {
        ...runtime,
        chatId: diagnostic.chatId,
        traceId: diagnostic.trace.id,
        diagnostics: diagnostic.trace.entries,
      }
    })
  }

  start(id: string) {
    if (
      !this.repository.stateSnapshot.runners.some((runner) => runner.id === id)
    )
      throw new Error("Runner not found.")
    if (this.processes.has(id)) return
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "EdU tutor runner",
      stdio: "ignore",
    })
    this.processes.set(id, child)
    this.runtime.set(id, {
      runnerId: id,
      status: "ready",
      activity: "Ready to learn",
      pid: child.pid,
    })
    child.on("spawn", () => {
      const state = this.runtime.get(id)
      if (state && this.processes.get(id) === child) {
        state.pid = child.pid
        this.notify()
      }
    })
    child.on("message", (payload) => {
      void this.handleEvent(id, child, payload).catch((error) =>
        this.fail(
          id,
          error instanceof Error
            ? error.message
            : "Could not save this lesson.",
        ),
      )
    })
    child.on("exit", (code) => {
      if (this.processes.get(id) !== child) return
      this.processes.delete(id)
      this.stopCodex(id)
      this.clearTimer(id)
      const state = this.runtime.get(id)
      if (state?.status === "running")
        this.fail(
          id,
          `Runner exited (${code}). Your saved notes are safe; retry this turn.`,
        )
      else {
        this.runtime.set(id, {
          runnerId: id,
          status: "stopped",
          activity: "Runner stopped",
        })
        this.notify()
      }
    })
    this.notify()
  }

  stop(id: string) {
    if (this.locks.has(id) || this.committing.has(id))
      throw new Error(
        "The runner is saving this turn. Try stopping again in a moment.",
      )
    const child = this.processes.get(id)
    this.processes.delete(id)
    this.clearTimer(id)
    this.stopCodex(id)
    child?.kill()
    const trace = this.traces.get(id)?.trace
    trace?.record("harness.stopped", {})
    void trace?.flush().catch(() => {})
    this.runtime.set(id, {
      runnerId: id,
      status: "stopped",
      activity: "Stopped. Send a message to resume from saved notes.",
    })
    this.notify()
  }

  async createTopic(input: z.infer<typeof CreateTopicSchema>) {
    const runners = this.repository.stateSnapshot.runners
    let runner = runners.find((item) => item.id === input.runnerId)
    if (!input.runnerId) runner = runners[0]
    if (!runner) throw new Error("Runner not found.")
    if (this.runtime.get(runner.id)?.status === "running" || this.locks.has(runner.id))
      throw new Error("This runner is already working. Wait for it to finish.")
    this.locks.add(runner.id)
    try {
      const connection = await this.getConnection(runner)
      let client: OpenAI | undefined
      if (runner.provider === "openrouter")
        client = new OpenAI({ apiKey: connection.apiKey, baseURL: "https://openrouter.ai/api/v1" })
      const title = await generateTopicTitle({ runner, ...connection }, input.title, client, () => {}, () => {})
      const topic = newTopic(title)
      topic.titleGenerated = true
      await this.repository.mutate((workspace) => workspace.topics.unshift(topic))
      this.notify()
      return topic.id
    } finally {
      this.locks.delete(runner.id)
    }
  }

  async send(input: z.infer<typeof SendSchema>) {
    const chat = this.repository.chat(input.chatId)
    const id = chat.runnerId
    if (this.runtime.get(id)?.status === "running" || this.locks.has(id))
      throw new Error(
        "This runner is already working. Use another runner or wait for it to finish.",
      )
    this.locks.add(id)
    try {
      const runner = this.repository.stateSnapshot.runners.find(
        (item) => item.id === id,
      )
      if (!runner) throw new Error("Runner not found.")
      const connection = await this.getConnection(runner)
      const topicIds = [
        ...new Set(parseTopicMentions(input.content).map((mention) => mention.id)),
      ]
      if (input.openedTopicId && !topicIds.includes(input.openedTopicId))
        topicIds.push(input.openedTopicId)
      for (const topicId of topicIds) this.repository.topic(topicId)
      if (input.confirmTopicId) {
        const topic = this.repository.topic(input.confirmTopicId)
        if (topic.planConfirmed || !topic.learning.outline.length)
          throw new Error("There is no draft plan to confirm.")
        if (!topicIds.includes(topic.id)) topicIds.push(topic.id)
      }
      this.start(id)
      const trace = new TurnTrace(
        join(this.repository.directory, "chats", chat.id, "diagnostics"),
      )
      this.traces.set(id, { chatId: chat.id, trace })
      trace.record("harness.start", {
        traceId: trace.id,
        chatId: chat.id,
        runnerId: id,
        provider: runner.provider,
        model: runner.model,
        effort: runner.reasoningEffort ?? null,
        taggedTopics: topicIds.length,
        confirmPlan: !!input.confirmTopicId,
      })
      await trace.flush()
      await this.repository.mutate((workspace) => {
        const current = workspace.chats.find((item) => item.id === chat.id)
        if (!current) throw new Error("Chat not found.")
        // CLI providers skip title generation, so the first request names the chat until a title is generated.
        if (!current.titleGenerated && current.messages.length === 0)
          current.title = stripTopicMentions(input.content).slice(0, 80)
        const confirmed = workspace.topics.find(
          (item) => item.id === input.confirmTopicId,
        )
        if (confirmed) confirmed.planConfirmed = true
        if (current.providerSession) current.providerSession.status = "pending"
        current.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.content,
          createdAt: new Date().toISOString(),
          topicIds,
        })
      })
      const child = this.processes.get(id)
      if (!child) throw new Error("Runner did not start. Try again.")
      this.runtime.set(id, {
        runnerId: id,
        status: "running",
        chatId: chat.id,
        activity: "Preparing your lesson",
        pid: child.pid,
      })
      this.timers.set(
        id,
        setTimeout(() => {
          if (this.committing.has(id)) return
          this.processes.delete(id)
          this.stopCodex(id)
          child.kill()
          this.fail(id, "The runner timed out. Retry with a smaller request.")
        }, 5 * 60_000),
      )
      child.postMessage({
        chat: { ...this.repository.chat(chat.id), providerSession: chat.providerSession },
        topics: this.contextTopics(chat.id).map((topic) => ({
          ...topic,
          assetDirectory: join(this.repository.directory, "topics", topic.id, "assets"),
        })),
        runner,
        ...connection,
        skillDirectory: this.skillDirectory,
        assetDirectory: join(this.repository.directory, "chats", chat.id, "assets"),
        confirmTopicId: input.confirmTopicId,
        openedTopicId: input.openedTopicId,
      })
      this.notify()
    } finally {
      this.locks.delete(id)
    }
  }

  // Tags persist for the whole chat; the most recently tagged topics stay in context within the prompt budget.
  private contextTopics(chatId: string) {
    const { chats, topics } = this.repository.stateSnapshot
    const ids = [
      ...new Set(
        chats
          .find((chat) => chat.id === chatId)
          ?.messages.flatMap((message) => message.topicIds)
          .reverse(),
      ),
    ].slice(0, 8)
    return topics.filter((topic) => ids.includes(topic.id))
  }

  private async handleEvent(
    id: string,
    child: Electron.UtilityProcess,
    payload: Parameters<typeof WorkerEventSchema.parse>[0],
  ) {
    if (this.processes.get(id) !== child) return
    const event = WorkerEventSchema.parse(payload)
    if (event.type === "codex_process") {
      if (event.pid) this.codexProcesses.set(id, event.pid)
      else this.codexProcesses.delete(id)
      return
    }
    const runtime = this.runtime.get(id)
    if (!runtime || runtime.status !== "running" || !runtime.chatId) return
    const chatId = runtime.chatId
    const trace = this.traces.get(id)?.trace
    if (event.type === "trace") {
      trace?.record(event.event, event.details)
      this.notify()
      return
    }
    if (event.type === "activity") {
      runtime.activity = event.activity
      this.notify()
      return
    }
    if (event.type === "title") {
      await this.repository.mutate((workspace) => {
        const chat = workspace.chats.find((item) => item.id === chatId)
        if (!chat || chat.titleGenerated) return
        chat.title = event.title
        chat.titleGenerated = true
      })
      this.notify()
      return
    }
    this.clearTimer(id)
    if (event.type === "error") {
      this.fail(id, event.error)
      return
    }
    this.committing.add(id)
    try {
      trace?.record("harness.commit_started", {
        replyCharacters: event.reply.length,
        phase: event.learning.phase,
        topicUpdates: event.topicUpdates.length,
      })
      const context = this.contextTopics(chatId).map((topic) => topic.id)
      const updates = event.topicUpdates.filter((update) =>
        context.includes(update.topicId),
      )
      await this.repository.mutate((workspace) => {
        const chat = workspace.chats.find((item) => item.id === chatId)
        if (!chat) throw new Error("Chat not found.")
        chat.learning = event.learning
        chat.providerSession = event.providerSession
        chat.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: event.reply,
          createdAt: new Date().toISOString(),
          topicIds: [],
        })
        for (const update of updates) {
          const topic = workspace.topics.find((item) => item.id === update.topicId)
          if (topic) topic.learning = update.learning
        }
      })
      trace?.record("harness.committed", {
        chatId,
        topicsUpdated: updates.length,
      })
      await trace?.flush()
      this.runtime.set(id, {
        runnerId: id,
        status: "ready",
        activity: "Ready to learn",
        pid: child.pid,
      })
      this.notify()
    } finally {
      this.committing.delete(id)
    }
  }

  private fail(id: string, error: string) {
    this.clearTimer(id)
    const child = this.processes.get(id)
    this.processes.delete(id)
    this.stopCodex(id)
    child?.kill()
    const trace = this.traces.get(id)?.trace
    trace?.record("harness.failed", { error })
    void trace?.flush().catch(() => {
      const runtime = this.runtime.get(id)
      if (runtime)
        runtime.error = `${error} The diagnostics file could not be written.`
      this.notify()
    })
    this.runtime.set(id, {
      runnerId: id,
      status: "error",
      activity: "Needs attention",
      error,
    })
    this.notify()
  }

  private stopCodex(id: string) {
    const pid = this.codexProcesses.get(id)
    this.codexProcesses.delete(id)
    if (pid) {
      try {
        process.kill(pid)
      } catch {}
    }
  }

  private clearTimer(id: string) {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  async shutdown() {
    while (this.committing.size || this.locks.size)
      await new Promise((resolve) => setTimeout(resolve, 25))
    for (const id of this.processes.keys()) this.stop(id)
    await Promise.all(
      [...this.traces.values()].map(({ trace }) =>
        trace.flush().catch(() => {}),
      ),
    )
  }
}
