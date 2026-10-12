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
} from "../shared/contracts"
import { WorkspaceRepository } from "../main/workspace"
import { TurnTrace } from "./trace"

export class RunnerManager {
  private codexProcesses = new Map<string, number>()
  private processes = new Map<string, Electron.UtilityProcess>()
  private runtime = new Map<string, z.infer<typeof RuntimeSchema>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private locks = new Set<string>()
  private committing = new Set<string>()
  private traces = new Map<string, { topicId: string; trace: TurnTrace }>()

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
        topicId: diagnostic.topicId,
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

  async send(input: z.infer<typeof SendSchema>) {
    const topic = this.repository.topic(input.topicId)
    const id = topic.runnerId
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
      if (
        input.action === "confirm_plan" &&
        (topic.planConfirmed || !topic.learning.outline.length)
      )
        throw new Error("There is no draft plan to confirm.")
      this.start(id)
      const trace = new TurnTrace(
        join(this.repository.directory, "topics", topic.id, "diagnostics"),
      )
      this.traces.set(id, { topicId: topic.id, trace })
      trace.record("harness.start", {
        traceId: trace.id,
        topicId: topic.id,
        runnerId: id,
        provider: runner.provider,
        model: runner.model,
        effort: runner.reasoningEffort ?? null,
        action: input.action,
      })
      await trace.flush()
      await this.repository.mutate((workspace) => {
        const current = workspace.topics.find((item) => item.id === topic.id)
        if (!current) throw new Error("Topic not found.")
        if (input.action === "confirm_plan") current.planConfirmed = true
        current.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.content,
          createdAt: new Date().toISOString(),
        })
      })
      const child = this.processes.get(id)
      if (!child) throw new Error("Runner did not start. Try again.")
      this.runtime.set(id, {
        runnerId: id,
        status: "running",
        topicId: topic.id,
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
        topic: this.repository.topic(topic.id),
        runner,
        ...connection,
        skillDirectory: this.skillDirectory,
        assetDirectory: join(
          this.repository.directory,
          "topics",
          topic.id,
          "assets",
        ),
        action: input.action,
      })
      this.notify()
    } finally {
      this.locks.delete(id)
    }
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
    if (!runtime || runtime.status !== "running" || !runtime.topicId) return
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
      const topicId = runtime.topicId
      await this.repository.mutate((workspace) => {
        const topic = workspace.topics.find((item) => item.id === topicId)
        if (!topic || topic.titleGenerated) return
        topic.learning.notes = topic.learning.notes.replace(`# ${topic.title}\n`, `# ${event.title}\n`)
        topic.title = event.title
        topic.titleGenerated = true
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
      const topicId = runtime.topicId
      trace?.record("harness.commit_started", {
        replyCharacters: event.reply.length,
        phase: event.learning.phase,
      })
      await this.repository.mutate((workspace) => {
        const topic = workspace.topics.find((item) => item.id === topicId)
        if (!topic) throw new Error("Topic not found.")
        topic.learning = event.learning
        topic.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: event.reply,
          createdAt: new Date().toISOString(),
        })
      })
      // JSON is the authoritative transaction; markdown mirrors can be rebuilt without losing the lesson.
      await this.repository
        .mirrorHandoff(this.repository.topic(topicId))
        .catch(() => {})
      trace?.record("harness.committed", {
        topicId,
        notesCharacters: event.learning.notes.length,
        outlineSections: event.learning.outline.length,
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
