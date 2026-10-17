import OpenAI from "openai"
import { WorkerJobSchema, type Diagnostic } from "../shared/contracts"
import { runTutorTurn } from "./tutor"
import { runCodexTutorTurn } from "./codex"
import { generateTopicTitle } from "./title"
import { runCliTutorTurn } from "./cli"
import { TurnTelemetry } from "./telemetry"

let busy = false
process.parentPort.on("message", async (event) => {
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
      name: "tutor.graph",
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
    let client: OpenAI | undefined
    if (job.runner.provider === "openrouter")
      client = new OpenAI({
        apiKey: job.apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        timeout: 120_000,
        maxRetries: 1,
      })
    if (!job.cli && !job.chat.titleGenerated && !job.chat.messages.some((message) => message.role === "assistant")) {
      activity("Naming your chat")
      try {
        const request = job.chat.messages.find((message) => message.role === "user")?.content ?? ""
        const title = await generateTopicTitle(job, request, client, processChanged, diagnostic)
        job.chat.title = title
        job.chat.titleGenerated = true
        process.parentPort.postMessage({ type: "title", title })
      } catch (error) {
        diagnostic("title.failed", { error: error instanceof Error ? error.message : "Could not generate a title." })
      }
    }
    let result
    if (job.runner.provider === "codex") {
      result = await runCodexTutorTurn(
        job,
        activity,
        processChanged,
        diagnostic,
        telemetry,
        onReply,
      )
    } else if (job.runner.provider === "claude" || job.runner.provider === "antigravity") {
      result = await runCliTutorTurn(job, activity, processChanged, diagnostic, telemetry)
    } else {
      if (!client) throw new Error("The OpenRouter connection is unavailable.")
      result = await runTutorTurn(job, client, activity, diagnostic, telemetry, onReply)
    }
    await flushTelemetry(false)
    process.parentPort.postMessage({ type: "result", ...result })
  } catch (error) {
    await flushTelemetry(true)
    let message = "The runner failed. Retry this turn."
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401)
        message = "Your model account connection expired. Reconnect in Settings → Providers."
      else if (error.status === 402)
        message = "Your OpenRouter account needs credits to continue."
      else if (error.status === 429)
        message = "The model is busy or rate limited. Wait briefly and retry."
      else
        message = `Model request failed (${error.status ?? "network"}). Retry or choose another model.`
    } else if (error instanceof Error) message = error.message
    process.parentPort.postMessage({ type: "error", error: message })
  } finally {
    busy = false
  }
})
