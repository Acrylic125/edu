import { messageText } from "../shared/message-text"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { type WorkerJob, type Diagnostic, ProviderSessionSchema } from "../shared/contracts"
import { CodexAppServer } from "../providers/codex-rpc"
import { readCodexModels } from "../providers/codex"
import { createTutorSession } from "./tutor"
import { runAgentGraph } from "./graph"
import type { TurnTelemetry } from "./telemetry"

const CallSchema = z.object({
  threadId: z.string(),
  tool: z.string(),
  arguments: z.json(),
})
const ItemSchema = z.object({
  threadId: z.string(),
  item: z.object({
    type: z.string(),
    id: z.string().optional(),
    text: z.string().optional(),
    phase: z.string().nullish(),
  }),
})
const TurnSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    status: z.enum(["completed", "failed", "interrupted"]),
    error: z.object({ message: z.string() }).nullish(),
  }),
})

export async function runCodexTutorTurn(
  job: WorkerJob,
  activity: (message: string) => void,
  processChanged: (pid: number | null) => void,
  diagnostic: Diagnostic = () => {},
  telemetry?: TurnTelemetry,
  onReply: (text: string) => void = () => {},
) {
  if (!job.codex)
    throw new Error(
      "The Codex runtime is unavailable. Refresh providers and retry.",
    )
  const cwd = dirname(job.assetDirectory)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  const session = await createTutorSession(job, activity, telemetry)
  const instructions = `${session.instructions}
Codex code-mode image handling: read_material returns a string containing the source text and inline image data URLs. Emit those URLs with image() to inspect the pixels; text() alone only prints encoded bytes. Use this pattern for a visual read:
const source = await tools.read_material({id: materialId, firstPage: 1, lastPage: 1, includeVisuals: true});
const imagePattern = /data:image\\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g;
for (const url of source.match(imagePattern) ?? []) image(url);
text(source.replace(imagePattern, "[image displayed]"));
Screenshots attached to the current learner message are also supplied directly as image inputs. Inspect them before concluding they are unreadable.`
  const client = new CodexAppServer(job.codex, cwd, diagnostic)
  diagnostic("codex.runtime", { cwd, codeModeHost: true })
  processChanged(client.child.pid ?? null)
  try {
    await client.initialize()
    const models = await readCodexModels(client)
    const model = models.find((entry) => entry.id === job.runner.model)
    if (!model)
      throw new Error(
        "This Codex model is unavailable. Choose a model from the provider catalog.",
      )
    diagnostic("codex.model", {
      model: model.id,
      effort:
        job.runner.reasoningEffort ?? model.defaultReasoningEffort ?? null,
    })
    if (
      job.runner.reasoningEffort &&
      !model.reasoningEfforts.includes(job.runner.reasoningEffort)
    )
      throw new Error(
        "This model does not support the selected reasoning effort.",
      )
    const parameters = {
      model: model.id,
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
      baseInstructions: instructions,
      dynamicTools: session.tools.map((tool) => {
        if (tool.type !== "function")
          throw new Error("Unsupported tutoring tool.")
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description ?? "",
          inputSchema: z.json().parse(tool.function.parameters),
        }
      }),
    }
    const previous = job.chat.providerSession
    const canResume =
      previous?.status === "ready" &&
      previous.toolVersion === 14 &&
      previous.home === job.codex.home &&
      previous.executable === job.codex.executable
    const responseSchema = z.object({ thread: z.object({ id: z.string() }) })
    let thread
    let resumed = false
    if (canResume) {
      try {
        thread = await client.request(
          "thread/resume",
          {
            threadId: previous.threadId,
            model: model.id,
            cwd,
            approvalPolicy: "never",
            sandbox: "read-only",
            baseInstructions: instructions,
            excludeTurns: true,
          },
          responseSchema,
        )
        resumed = true
      } catch (error) {
        // Only an explicitly missing native thread allows reconstruction; transient failures must not duplicate turns.
        if (
          !(error instanceof Error) ||
          !/thread.*(?:not found|does not exist)|no rollout found|session.*not found/i.test(error.message)
        ) throw error
        diagnostic("codex.session_missing", { threadId: previous.threadId })
      }
    }
    if (!thread)
      thread = await client.request("thread/start", parameters, responseSchema)
    const threadId = thread.thread.id
    const providerSession = ProviderSessionSchema.parse({
      provider: "codex",
      threadId,
      home: job.codex.home,
      executable: job.codex.executable,
      toolVersion: 14,
      status: "ready",
    })
    diagnostic("codex.session", { threadId, resumed })
    let toolCount = 0
    let sequence = Promise.resolve()
    let toolContext = telemetry?.capture()
    client.onRequest = async (method, params) => {
      if (method !== "item/tool/call")
        throw new Error("Only tutoring tools are available.")
      const call = CallSchema.parse(params)
      diagnostic("tool.call", { tool: call.tool, threadId: call.threadId })
      if (call.threadId !== threadId)
        throw new Error("Invalid tutoring thread.")
      if (++toolCount > 48)
        throw new Error("The runner reached its tool limit.")
      const parent = toolContext
      const operation = sequence.then(() => {
        if (telemetry && parent)
          return telemetry.within(parent, () => session.execute(call.tool, call.arguments))
        return session.execute(call.tool, call.arguments)
      })
      sequence = operation.then(
        () => {},
        () => {},
      )
      const output = await operation
      diagnostic("tool.result", {
        tool: call.tool,
        success: output.success,
        error: output.success ? null : output.text,
      })
      const contentItems: z.infer<ReturnType<typeof z.json>>[] = [
        { type: "inputText", text: output.text },
      ]
      for (const image of output.images) {
        if (image.type === "text")
          contentItems.push({ type: "inputText", text: image.text })
        else if (image.type === "image_url")
          contentItems.push({
            type: "inputImage",
            imageUrl: image.image_url.url,
          })
      }
      return { success: output.success, contentItems }
    }
    let reply = ""
    let answerItem: string | undefined
    client.notifications.on("item/started", (raw: z.infer<ReturnType<typeof z.json>>) => {
      const event = ItemSchema.safeParse(raw)
      if (!event.success || event.data.threadId !== threadId) return
      if (event.data.item.type !== "agentMessage" || event.data.item.phase === "commentary") return
      answerItem = event.data.item.id
      reply = ""
      onReply("")
    })
    const DeltaSchema = z.object({ threadId: z.string(), itemId: z.string(), delta: z.string() })
    client.notifications.on("item/agentMessage/delta", (raw: z.infer<ReturnType<typeof z.json>>) => {
      const event = DeltaSchema.safeParse(raw)
      if (!event.success || event.data.threadId !== threadId || event.data.itemId !== answerItem) return
      reply += event.data.delta
      onReply(session.previewReply(reply))
    })
    client.notifications.on(
      "item/completed",
      (raw: z.infer<ReturnType<typeof z.json>>) => {
        const item = ItemSchema.safeParse(raw)
        if (!item.success || item.data.threadId !== threadId) return
        if (
          item.data.item.type === "agentMessage" &&
          item.data.item.phase !== "commentary"
        ) {
          reply = item.data.item.text ?? reply
          onReply(session.previewReply(reply))
        }
      },
    )
    let input = `Continue this tutoring conversation from the saved handoff. The last entry is the current learner request.\n${JSON.stringify(job.chat.messages.map((message) => ({ role: message.role, content: session.modelText(messageText(message)) })))}`
    if (resumed) {
      const request = job.chat.messages.at(-1)
      if (!request || request.role !== "user") throw new Error("The current learner request is missing.")
      input = session.modelText(request.content)
    }
    const imageInput: z.infer<ReturnType<typeof z.json>>[] = []
    const request = job.chat.messages.at(-1)
    if (request) {
      for (const part of await session.readMessageImages(request)) {
        if (part.type === "text") imageInput.push({ type: "text", text: part.text })
        if (part.type === "image_url") imageInput.push({ type: "image", url: part.image_url.url, detail: "high" })
      }
    }
    return await runAgentGraph({
      limit: 3,
      diagnostic,
      telemetry,
      runner: { ...job.runner, model: model.id },
      async run(attempt) {
        toolContext = telemetry?.capture()
        reply = ""
        answerItem = undefined
        onReply("")
        const completion = client.waitFor(
          "turn/completed",
          TurnSchema.refine((event) => event.threadId === threadId),
        )
        void completion.promise.catch(() => {})
        try {
          if (attempt === 1) activity("Preparing your lesson with Codex")
          else activity("Completing study notes with Codex")
          diagnostic("turn.start", {
            attempt,
            recovery: attempt > 1,
          })
          await client.request(
            "turn/start",
            {
              threadId,
              input: [{ type: "text", text: input }, ...imageInput],
              effort:
                job.runner.reasoningEffort ??
                model.defaultReasoningEffort ??
                null,
            },
            z.object({}).passthrough(),
          )
          const event = await completion.promise
          await sequence
          diagnostic("turn.completed", {
            attempt,
            status: event.turn.status,
            saved: session.saved,
            replyCharacters: reply.length,
            saveError: session.saveError ?? null,
          })
          if (event.turn.status !== "completed")
            throw new Error(
              event.turn.error?.message ??
                "Codex was interrupted. Retry from your saved notes.",
            )
          return "validate"
        } finally {
          completion.dispose()
        }
      },
      ready: () => session.saved && !!reply.trim(),
      recover() {
        if (!session.saved) {
          input =
            "Complete the current learner request without advancing the lesson. Repair each rejected save using its original tool and target first. Use the structured topic tools for JSON state and updateTopic for conceptual notes; save_learning_state only saves this chat's private handoff and next action. Then save the chat handoff and provide the learner-facing reply. The previous reply was not saved."
          if (session.saveError)
            input += `\nCorrect this rejected save: ${session.saveError}`
        } else {
          input =
            "The learning state is staged, but the learner-facing reply is missing. Provide the explanation, question, or plan for this same learner request without advancing the lesson."
        }
      },
      finish: () => ({ ...session.finish(reply), providerSession }),
      exhausted: () => new Error(
        session.saveError ??
        `Codex did not save a complete learning state after 3 attempts (${toolCount} tutoring tool calls). Open Diagnostics to inspect the turn trace.`,
      ),
    })
  } finally {
    client.close()
    processChanged(null)
  }
}
