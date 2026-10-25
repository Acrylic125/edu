import { WorkerJobSchema, type Diagnostic } from "../shared/contracts"
import { runCodexTutorTurn } from "./codex"
import { generateTopicTitle } from "./title"
import { runCliTutorTurn } from "./cli"
import { TurnTelemetry } from "./telemetry"
import { TutorPublicationError } from "./publication-error"
import { WorkflowResponseSchema } from "../shared/tutor-workflow"
import { createWorkflowClient } from "./workflow-client"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"
import { parseScratchpadCommand } from "../shared/scratchpad-commands"
import { createTutorGraph, type WorkflowNativeRunner } from "./tutor-graph"

let busy = false
let workflowClient: ReturnType<typeof createWorkflowClient> | undefined
process.parentPort.on("message", async (event) => {
  const response = WorkflowResponseSchema.safeParse(event.data)
  if (response.success) {
    workflowClient?.receive(response.data)
    return
  }
  if (busy) {
    process.parentPort.postMessage({
      type: "error",
      error: "This runner is already working.",
    })
    return
  }
  busy = true
  let telemetry: TurnTelemetry | undefined
  const flushTelemetry = async (failed: boolean) => {
    try {
      await telemetry?.finish(failed)
    } catch {
      process.parentPort.postMessage({ type: "trace", event: "telemetry.failed", details: { error: "Could not write Phoenix trace files." } })
    }
  }
  try {
    const job = WorkerJobSchema.parse(event.data)
    if (job.telemetry) telemetry = new TurnTelemetry({
      ...job.telemetry,
      name: "tutor.run",
      attributes: { "session.id": job.chat.id, "edu.runner.id": job.runner.id, "edu.provider": job.runner.provider },
    })
    const activity = (activity: string) =>
      process.parentPort.postMessage({ type: "activity", activity })
    const onReply = (text: string) =>
      process.parentPort.postMessage({ type: "reply", text })
    const diagnostic: Diagnostic = (event, details) =>
      process.parentPort.postMessage({ type: "trace", event, details })
    const processChanged = (pid: number | null) =>
      process.parentPort.postMessage({ type: "codex_process", pid })
    const creationCommand = parseScratchpadCommand(job.chat.messages.at(-1)?.content ?? "")
    if (creationCommand?.type !== "topic" && !job.cli && !job.chat.titleGenerated && !job.chat.messages.some((message) => message.role === "assistant")) {
      activity("Naming your chat")
      try {
        const request = job.chat.messages.find((message) => message.role === "user")?.content ?? ""
        const title = await generateTopicTitle(job, request, processChanged, diagnostic)
        job.chat.title = title
        job.chat.titleGenerated = true
        process.parentPort.postMessage({ type: "title", title })
      } catch (error) {
        diagnostic("title.failed", { error: error instanceof Error ? error.message : "Could not generate a title." })
      }
    }
    if (!job.workflow) throw new Error("A durable turn workflow is required.")
    workflowClient = createWorkflowClient(job.workflow.attemptId, (message) => process.parentPort.postMessage(message))
    const checkpointer = new SqliteCheckpointSaver(job.workflow.checkpointPath)
    try {
      const native: WorkflowNativeRunner = async (input, session, invocationId) => {
        let phase = "tutor"
        if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "submit_topic_plan")) phase = "planner"
        else if (session.tools.some((tool) => tool.type === "function" && tool.function.name === "finish_role")) phase = "role"
        else if (!session.tools.length) phase = "compaction"
        const invoke = async () => {
          const changed = (pid: number | null) => process.parentPort.postMessage({ type: "codex_process", invocationId, pid })
          const host = workflowClient!.host
          await host.beginInvocation(job.chat.id, job.workflow!.turnId, invocationId)
          try {
            let result
            if (input.runner.provider === "codex") result = await runCodexTutorTurn(input, activity, changed, diagnostic, telemetry, onReply, session)
            else result = await runCliTutorTurn(input, activity, changed, diagnostic, telemetry, session)
            await host.endInvocation(job.chat.id, job.workflow!.turnId, invocationId, true)
            return result
          } catch (error) {
            await host.endInvocation(job.chat.id, job.workflow!.turnId, invocationId, false)
            throw error
          }
        }
        if (telemetry) return telemetry.span("workflow.invocation", "CHAIN", invoke, { "edu.invocation.id": invocationId, "edu.workflow.phase": phase })
        return invoke()
      }
      const graph = createTutorGraph(workflowClient.host, native, checkpointer, { codex: job.codex, cli: job.cli, apiKey: job.apiKey }, activity)
      const saved = await checkpointer.getTuple({ configurable: { thread_id: job.workflow.turnId } })
      let input: { chatId: string; turnId: string } | null = { chatId: job.chat.id, turnId: job.workflow.turnId }
      if (job.workflow.resume && saved) input = null
      await graph.invoke(input, { configurable: { thread_id: job.workflow.turnId }, durability: "sync", recursionLimit: 100 })
    } finally {
      checkpointer.close()
      workflowClient.close()
      workflowClient = undefined
    }
    await flushTelemetry(false)
    process.parentPort.postMessage({ type: "workflow_complete", turnId: job.workflow.turnId })
  } catch (error) {
    if (error instanceof TutorPublicationError)
      process.parentPort.postMessage({ type: "trace", event: "tutor.publication_failed", details: { error: error.detail } })
    await flushTelemetry(true)
    let message = "The runner failed. Retry this turn."
    if (error instanceof Error) message = error.message
    process.parentPort.postMessage({ type: "error", error: message })
  } finally {
    workflowClient?.close()
    workflowClient = undefined
    busy = false
  }
})
