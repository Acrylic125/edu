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
import { TurnTelemetry } from "./telemetry"
import { applyTopicMutation } from "../main/state-service"

export class RunnerManager {
  private codexProcesses = new Map<string, number>()
  private processes = new Map<string, Electron.UtilityProcess>()
  private runtime = new Map<string, z.infer<typeof RuntimeSchema>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private locks = new Set<string>()
  private topicLocks = new Set<string>()
  private committing = new Set<string>()
  private traces = new Map<string, { chatId: string; trace: TurnTrace; telemetry: TurnTelemetry; startedAt: number }>()

  constructor(
    private repository: WorkspaceRepository,
    private workerPath: string,
    private skillDirectory: string,
    private getConnection: (
      runner: z.infer<typeof RunnerSchema>,
    ) => Promise<Pick<WorkerJob, "apiKey" | "codex" | "cli" | "titleModel">>,
    private notify: () => void,
    private phoenixExporterInstalled = true,
  ) {}

  get statuses() {
    return this.repository.stateSnapshot.runners.flatMap((runner) => {
      const executions = [...this.runtime.entries()].filter(([, runtime]) => runtime.runnerId === runner.id)
      if (!executions.length) return [{
        runnerId: runner.id,
        status: "stopped" as const,
        activity: "Starts automatically when you send a message",
      }]
      return executions.map(([id, runtime]) => {
        const diagnostic = this.traces.get(id)
        if (!diagnostic) return runtime
        return {
          ...runtime,
          chatId: diagnostic.chatId,
          traceId: diagnostic.trace.id,
          diagnostics: diagnostic.trace.entries,
        }
      })
    })
  }

  start(runnerId: string, chatId?: string) {
    if (!this.repository.stateSnapshot.runners.some((runner) => runner.id === runnerId))
      throw new Error("Runner not found.")
    const id = chatId ?? runnerId
    if (this.processes.has(id)) return
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "EdU tutor runner",
      stdio: "ignore",
    })
    this.processes.set(id, child)
    this.runtime.set(id, {
      runnerId,
      chatId,
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
      void this.handleEvent(id, child, payload).catch((error) => {
        if (this.processes.get(id) !== child) return
        this.fail(id, error instanceof Error ? error.message : "Could not save this lesson.")
      })
    })
    child.on("exit", (code) => {
      if (this.processes.get(id) !== child) return
      this.processes.delete(id)
      this.stopCodex(id)
      this.clearTimer(id)
      const state = this.runtime.get(id)
      if (state?.status === "running")
        this.fail(id, `Runner exited (${code}). Your saved notes are safe; retry this turn.`)
      else {
        this.runtime.set(id, { runnerId, chatId, status: "stopped", activity: "Runner stopped" })
        this.notify()
      }
    })
    this.notify()
  }

  stop(runnerId: string, chatId?: string) {
    const ids = [...this.runtime.entries()]
      .filter(([, runtime]) => runtime.runnerId === runnerId && (!chatId || runtime.chatId === chatId))
      .map(([id]) => id)
    const locked = this.repository.stateSnapshot.chats.some((chat) =>
      chat.runnerId === runnerId && (!chatId || chat.id === chatId) && this.locks.has(chat.id),
    )
    if (locked || (!chatId && this.topicLocks.has(runnerId)) || ids.some((id) => this.committing.has(id)))
      throw new Error("The runner is saving this turn. Try stopping again in a moment.")
    for (const id of ids) this.stopExecution(id)
  }

  private stopExecution(id: string) {
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
    void this.finishTelemetry(id, true)
    void trace?.flush().catch(() => {})
    this.runtime.set(id, {
      runnerId: this.runtime.get(id)?.runnerId ?? id,
      chatId: this.runtime.get(id)?.chatId,
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
    if (this.topicLocks.has(runner.id))
      throw new Error("This runner is already working. Wait for it to finish.")
    this.topicLocks.add(runner.id)
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
      this.topicLocks.delete(runner.id)
    }
  }

  async send(input: z.infer<typeof SendSchema>) {
    const chat = this.repository.chat(input.chatId)
    const id = chat.id
    const runnerId = chat.runnerId
    if (this.runtime.get(id)?.status === "running" || this.locks.has(id))
      throw new Error(
        "This chat is already working. Wait for it to finish.",
      )
    this.locks.add(id)
    const startedAt = performance.now()
    let started = false
    try {
      const runner = this.repository.stateSnapshot.runners.find(
        (item) => item.id === runnerId,
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
      const attachmentMaterials = [
        ...chat.materials,
        ...this.repository.stateSnapshot.topics.filter((topic) => topicIds.includes(topic.id)).flatMap((topic) => topic.materials),
      ]
      if (input.materialIds?.some((id) => !attachmentMaterials.some((material) => material.id === id && material.kind === "image")))
        throw new Error("An attached image is not available in this chat.")
      this.start(runnerId, chat.id)
      const trace = new TurnTrace(
        join(this.repository.directory, "chats", chat.id, "diagnostics"),
      )
      const telemetryDirectory = join(this.repository.directory, "phoenix")
      const telemetry = new TurnTelemetry({
        directory: telemetryDirectory,
        name: "tutor.turn",
        attributes: { "session.id": chat.id, "edu.runner.id": runnerId, "edu.provider": runner.provider, "llm.model_name": runner.model },
      })
      this.traces.set(id, { chatId: chat.id, trace, telemetry, startedAt })
      started = true
      trace.record("harness.start", {
        traceId: trace.id,
        chatId: chat.id,
        runnerId,
        provider: runner.provider,
        model: runner.model,
        effort: runner.reasoningEffort ?? null,
        taggedTopics: topicIds.length,
        confirmPlan: !!input.confirmTopicId,
      })
      if (!this.phoenixExporterInstalled)
        trace.record("telemetry.exporter_unavailable", { error: "Could not install the portable Phoenix exporter. Use the copy in the app's resources." })
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
        const sentMaterialIds = new Set(current.messages.flatMap((message) => message.materialIds ?? []))
        const materialIds = input.materialIds ?? attachmentMaterials
          .filter((material) => material.kind === "image" && !sentMaterialIds.has(material.id))
          .map((material) => material.id)
        current.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.content,
          materialIds,
          createdAt: new Date().toISOString(),
          topicIds,
        })
      })
      const child = this.processes.get(id)
      if (!child) throw new Error("Runner did not start. Try again.")
      this.runtime.set(id, {
        runnerId,
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
        telemetry: { directory: telemetryDirectory, parent: telemetry.context },
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
        workspaceTopics: this.repository.stateSnapshot.topics.map((topic) => ({
          id: topic.id, title: topic.title, archived: topic.archived, notes: topic.learning.notes, state: topic.state,
        })),
      })
      this.notify()
    } catch (error) {
      if (started) this.fail(id, error instanceof Error ? error.message : "Could not start this lesson.")
      throw error
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
    if (event.type === "reply") {
      runtime.reply = event.text
      this.notify()
      return
    }
    if (event.type === "activity") {
      runtime.activity = event.activity
      this.notify()
      return
    }
    if (event.type === "title") {
      const commit = () => this.repository.mutate((workspace) => {
        const chat = workspace.chats.find((item) => item.id === chatId)
        if (!chat || chat.titleGenerated) return
        chat.title = event.title
        chat.titleGenerated = true
      })
      const telemetry = this.traces.get(id)?.telemetry
      if (telemetry) await telemetry.span("title.commit", "CHAIN", commit)
      else await commit()
      this.notify()
      return
    }
    this.clearTimer(id)
    if (event.type === "error") {
      this.fail(id, event.error)
      return
    }
    const turn = this.traces.get(id)
    const durationMs = turn ? Math.max(0, performance.now() - turn.startedAt) : undefined
    this.committing.add(id)
    try {
      trace?.record("harness.commit_started", {
        replyCharacters: event.reply.length,
        phase: event.learning.phase,
        topicMutations: event.topicMutations.length,
      })
      const context = this.contextTopics(chatId).map((topic) => topic.id)
      const commit = () => this.repository.mutate((workspace) => {
        const writable = new Set(context)
        for (const mutation of event.topicMutations) {
          if (mutation.type === "createTopic") {
            writable.add(mutation.topicId)
          } else if (!writable.has(mutation.topicId)) {
            throw new Error("Only tagged or newly created topics can be written.")
          }
          applyTopicMutation(workspace, chatId, mutation)
        }
        if (event.topicUpdates.length) throw new Error("Legacy topic writes are no longer supported. Retry with structured topic tools.")
        const chat = workspace.chats.find((item) => item.id === chatId)
        if (!chat) throw new Error("Chat not found.")
        chat.learning = event.learning
        chat.providerSession = event.providerSession
        chat.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: event.reply,
          ...(event.learning.responseQuestion && { responseQuestion: event.learning.responseQuestion }),
          durationMs,
          createdAt: new Date().toISOString(),
          topicIds: event.topicMutations.filter((mutation) => mutation.type === "createTopic").map((mutation) => mutation.topicId),
        })

      })
      const telemetry = this.traces.get(id)?.telemetry
      if (telemetry) await telemetry.span("harness.commit", "CHAIN", commit)
      else await commit()
      trace?.record("harness.committed", {
        chatId,
        topicMutations: event.topicMutations.length,
      })
      await this.finishTelemetry(id, false)
      await trace?.flush()
      this.runtime.set(id, {
        runnerId: runtime.runnerId,
        chatId,
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
    void this.finishTelemetry(id, true)
    void trace?.flush().catch(() => {
      const runtime = this.runtime.get(id)
      if (runtime)
        runtime.error = `${error} The diagnostics file could not be written.`
      this.notify()
    })
    this.runtime.set(id, {
      runnerId: this.runtime.get(id)?.runnerId ?? id,
      chatId: this.runtime.get(id)?.chatId,
      status: "error",
      activity: "Needs attention",
      error,
    })
    this.notify()
  }

  private async finishTelemetry(id: string, failed: boolean) {
    const diagnostic = this.traces.get(id)
    if (!diagnostic) return
    try {
      await diagnostic.telemetry.finish(failed)
    } catch {
      diagnostic.trace.record("telemetry.failed", { error: "Could not write Phoenix trace files." })
      await diagnostic.trace.flush().catch(() => {})
    }
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
    while (this.committing.size || this.locks.size || this.topicLocks.size)
      await new Promise((resolve) => setTimeout(resolve, 25))
    for (const id of this.processes.keys()) this.stopExecution(id)
    await Promise.all(
      [...this.traces.values()].map(({ trace }) =>
        trace.flush().catch(() => {}),
      ),
    )
    await Promise.all([...this.traces.keys()].map((id) => this.finishTelemetry(id, true)))
  }
}
