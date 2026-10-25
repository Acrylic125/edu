import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { utilityProcess } from "electron"
import { z } from "zod"
import {
  WorkerEventSchema,
  type RuntimeSchema,
  type SendSchema,
  type RunnerSchema,
  type WorkerJob,
  CreateTopicSchema,
  WorkerJobSchema,
  RetrySchema,
} from "../shared/contracts"
import { parseTopicMentions, stripTopicMentions } from "../shared/topic-mentions"
import { newTopic, WorkspaceRepository } from "../main/workspace"
import { generateTopicTitle } from "./title"
import { TurnTrace } from "./trace"
import { TurnTelemetry } from "./telemetry"
import { dispatchWorkflowRequest, TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkflowRequestSchema } from "../shared/tutor-workflow"

export class RunnerManager {
  private codexProcesses = new Map<string, Map<string, number>>()
  private processes = new Map<string, Electron.UtilityProcess>()
  private runtime = new Map<string, z.infer<typeof RuntimeSchema>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private locks = new Set<string>()
  private topicLocks = new Set<string>()
  private committing = new Set<string>()
  private workflowRequests = new Map<string, Set<string>>()
  private failures = new Map<string, Promise<void>>()
  private workflows: TutorWorkflowRepository
  private traces = new Map<string, { chatId: string; trace: TurnTrace; telemetry: TurnTelemetry; startedAt: number }>()

  constructor(
    private repository: WorkspaceRepository,
    private workerPath: string,
    private skillDirectory: string,
    private getConnection: (
      runner: z.infer<typeof RunnerSchema>,
    ) => Promise<Pick<WorkerJob, "apiKey" | "codex" | "cli">>,
    private notify: () => void,
    private phoenixExporterInstalled = true,
  ) {
    this.workflows = new TutorWorkflowRepository(repository)
  }

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
    if (this.runtime.get(id)?.status === "running") {
      this.fail(id, "The turn was stopped. Retry to continue its saved workflow.")
      return
    }
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

  async createTopic(raw: z.input<typeof CreateTopicSchema>) {
    const input = CreateTopicSchema.parse(raw)
    const runners = this.repository.stateSnapshot.runners
    let runner = runners.find((item) => item.id === input.runnerId)
    if (!input.runnerId) runner = runners[0]
    if (!runner) throw new Error("Runner not found.")
    if (this.topicLocks.has(runner.id))
      throw new Error("This runner is already working. Wait for it to finish.")
    this.topicLocks.add(runner.id)
    try {
      const connection = await this.getConnection(runner)
      const title = await generateTopicTitle({ runner, ...connection }, input.title, () => {}, () => {})
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
    const runtime = this.runtime.get(chat.id)
    let failedTurnId = chat.failedTurnId
    if (runtime?.status === "error" && runtime.turnId) failedTurnId = runtime.turnId
    if (/^\s*retry[.!]?\s*$/i.test(input.content) && failedTurnId)
      return this.retry({ chatId: chat.id, turnId: failedTurnId })
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
      if (input.materialIds?.some((id) => !attachmentMaterials.some((material) => material.id === id)))
        throw new Error("An attached file is not available in this chat.")
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
      let turnWorkspace = this.repository.stateSnapshot
      await this.repository.mutate((workspace) => {
        const current = workspace.chats.find((item) => item.id === chat.id)
        if (!current) throw new Error("Chat not found.")
        current.topicHandles = [...new Set([...current.topicHandles, ...workspace.topics.map((topic) => topic.id)])]
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
          .filter((material) => !sentMaterialIds.has(material.id))
          .map((material) => material.id)
        current.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.content,
          materialIds,
          createdAt: new Date().toISOString(),
          topicIds,
        })
        // Other chats can create topics before dispatch; their IDs must not shift this turn's handle mapping.
        turnWorkspace = structuredClone(workspace)
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
      const job = WorkerJobSchema.parse({
        telemetry: { directory: telemetryDirectory, parent: telemetry.context },
        chat: { ...turnWorkspace.chats.find((item) => item.id === chat.id), providerSession: chat.providerSession },
        topics: this.contextTopics(chat.id, turnWorkspace).map((topic) => ({
          ...topic,
          assetDirectory: join(this.repository.directory, "scratchpads", topic.id, "assets"),
        })),
        runner,
        ...connection,
        skillDirectory: this.skillDirectory,
        assetDirectory: join(this.repository.directory, "chats", chat.id, "assets"),
        sourceCacheDirectory: join(this.repository.directory, "source-cache"),
        confirmTopicId: input.confirmTopicId,
        openedTopicId: input.openedTopicId,
        workspaceTopics: turnWorkspace.topics.map((topic) => ({
          id: topic.id, title: topic.title, archived: topic.archived, notes: topic.learning.notes, state: topic.state, materials: topic.materials,
          assetDirectory: join(this.repository.directory, "scratchpads", topic.id, "assets"),
        })),
      })
      const turn = await this.workflows.start(job)
      const runtime = this.runtime.get(id)
      if (runtime) runtime.turnId = turn.turnId
      child.postMessage({ ...job, workflow: {
        turnId: turn.turnId, attemptId: turn.attemptId, resume: false,
        checkpointPath: join(this.repository.directory, "chats", chat.id, "workflows", `${turn.turnId}.sqlite`),
      } })
      this.notify()
    } catch (error) {
      if (started) this.fail(id, error instanceof Error ? error.message : "Could not start this lesson.")
      throw error
    } finally {
      this.locks.delete(id)
    }
  }

  async retry(raw: z.infer<typeof RetrySchema>) {
    const input = RetrySchema.parse(raw)
    const id = input.chatId
    if (this.runtime.get(id)?.status === "running" || this.locks.has(id)) throw new Error("This chat is already working.")
    this.locks.add(id)
    try {
      await this.failures.get(id)
      const saved = this.workflows.get(id, input.turnId)
      if (saved.receipt) {
        this.workflows.complete(id, input.turnId)
        this.runtime.set(id, { runnerId: saved.source.runner.id, chatId: id, status: "ready", activity: "Ready to learn" })
        this.notify()
        return
      }
      const connection = await this.getConnection(saved.source.runner)
      const turn = await this.workflows.retry(id, input.turnId)
      this.start(turn.source.runner.id, id)
      const child = this.processes.get(id)
      if (!child) throw new Error("Runner did not start.")
      const trace = new TurnTrace(join(this.repository.directory, "chats", id, "diagnostics"))
      const directory = join(this.repository.directory, "phoenix")
      const telemetry = new TurnTelemetry({ directory, name: "tutor.retry", attributes: { "session.id": id, "edu.turn.id": turn.turnId } })
      this.traces.set(id, { chatId: id, trace, telemetry, startedAt: performance.now() })
      trace.record("harness.resume", { chatId: id, turnId: turn.turnId })
      await trace.flush()
      this.runtime.set(id, { runnerId: turn.source.runner.id, chatId: id, turnId: turn.turnId, status: "running", activity: "Resuming your lesson", pid: child.pid })
      this.timers.set(id, setTimeout(() => { if (!this.committing.has(id)) this.fail(id, "The runner timed out. Retry to continue the saved workflow.") }, 5 * 60_000))
      child.postMessage({ ...turn.source, ...connection, telemetry: { directory, parent: telemetry.context }, workflow: {
        turnId: turn.turnId, attemptId: turn.attemptId, resume: true,
        checkpointPath: join(this.repository.directory, "chats", id, "workflows", `${turn.turnId}.sqlite`),
      } })
      this.notify()
    } catch (error) {
      if (this.runtime.get(id)?.status === "running") this.fail(id, error instanceof Error ? error.message : "Could not resume the turn.")
      throw error
    } finally {
      this.locks.delete(id)
    }
  }

  // Tags persist for the whole chat; the most recently tagged topics stay in context within the prompt budget.
  private contextTopics(chatId: string, { chats, topics } = this.repository.stateSnapshot) {
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
      const processes = this.codexProcesses.get(id) ?? new Map<string, number>()
      const invocation = event.invocationId ?? "title"
      if (event.pid) processes.set(invocation, event.pid)
      else processes.delete(invocation)
      this.codexProcesses.set(id, processes)
      const runtime = this.runtime.get(id)
      if (event.pid && event.invocationId && runtime?.chatId && runtime.turnId)
        await this.workflows.nativeStarted(runtime.chatId, runtime.turnId, event.invocationId, event.pid)
      return
    }
    const runtime = this.runtime.get(id)
    if (!runtime || runtime.status !== "running" || !runtime.chatId) return
    const chatId = runtime.chatId
    const trace = this.traces.get(id)?.trace
    if (event.type === "workflow_request") {
      const pending = this.workflowRequests.get(id) ?? new Set<string>()
      pending.add(event.requestId)
      this.workflowRequests.set(id, pending)
      this.committing.add(id)
      try {
        const request = WorkflowRequestSchema.parse(event.request)
        if (request.chatId !== chatId || request.turnId !== runtime.turnId) throw new Error("The request does not belong to this active turn.")
        const turn = this.workflows.get(chatId, request.turnId)
        if (turn.attemptId !== event.attemptId) throw new Error("This workflow attempt has been superseded.")
        const diagnostic = this.traces.get(id)
        let durationMs: number | undefined
        if ((request.operation === "saveReply" || request.operation === "presentPlan") && diagnostic) {
          durationMs = Math.max(0, performance.now() - diagnostic.startedAt)
        }
        const result = await dispatchWorkflowRequest(this.workflows, request, durationMs)
        child.postMessage({ type: "workflow_response", requestId: event.requestId, result: z.json().parse(JSON.parse(JSON.stringify(result ?? null))) })
        if (request.operation === "commitBatch" || request.operation === "saveReply" || request.operation === "presentPlan") this.notify()
      } catch (error) {
        child.postMessage({ type: "workflow_response", requestId: event.requestId, error: error instanceof Error ? error.message : "Workflow request failed." })
      } finally {
        pending.delete(event.requestId)
        if (!pending.size) this.committing.delete(id)
      }
      return
    }
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
    if (event.type !== "workflow_complete" || event.turnId !== runtime.turnId)
      throw new Error("A verified workflow completion is required.")
    const completion = this.workflows.complete(chatId, event.turnId)
    trace?.record("harness.committed", { chatId, turnId: event.turnId, receiptId: completion.receipt.receiptId })
    await this.finishTelemetry(id, false)
    await trace?.flush()
    this.runtime.set(id, { runnerId: runtime.runnerId, chatId, status: "ready", activity: "Ready to learn", pid: child.pid })
    this.notify()
  }

  private fail(id: string, error: string) {
    this.clearTimer(id)
    const child = this.processes.get(id)
    this.processes.delete(id)
    this.stopCodex(id)
    child?.kill()
    const trace = this.traces.get(id)?.trace
    const runtime = this.runtime.get(id)
    if (runtime?.chatId && runtime.turnId) {
      const failure = this.workflows.fail(runtime.chatId, runtime.turnId, error).then(() => { this.notify() }).catch((issue) => {
        trace?.record("workflow.failure_save_failed", { error: issue instanceof Error ? issue.message : "Could not save failed turn." })
      })
      this.failures.set(id, failure)
    }
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
      turnId: runtime?.turnId,
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
    const processes = this.codexProcesses.get(id)
    this.codexProcesses.delete(id)
    for (const pid of processes?.values() ?? []) {
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
    await Promise.all(this.failures.values())
  }
}
