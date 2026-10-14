import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { type WorkerJob, type Diagnostic, ProviderSessionSchema } from "../shared/contracts"
import { CodexAppServer } from "../providers/codex-rpc"
import { readCodexModels } from "../providers/codex"
import { createTutorSession } from "./tutor"

const CallSchema = z.object({
  threadId: z.string(),
  tool: z.string(),
  arguments: z.json(),
})
const ItemSchema = z.object({
  threadId: z.string(),
  item: z.object({
    type: z.string(),
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
) {
  if (!job.codex)
    throw new Error(
      "The Codex runtime is unavailable. Refresh providers and retry.",
    )
  const cwd = dirname(job.assetDirectory)
  await mkdir(cwd, { recursive: true, mode: 0o700 })
  const session = await createTutorSession(job, activity)
  const client = new CodexAppServer(job.codex, cwd, diagnostic)
  diagnostic("codex.runtime", { cwd, codeModeHost: true })
  processChanged(client.child.pid ?? null)
  try {
    await client.initialize()
    const models = await readCodexModels(client)
    let model = models.find((entry) => entry.id === job.runner.model)
    if (job.runner.model === "default")
      model = models.find((entry) => entry.isDefault) ?? models[0]
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
      baseInstructions: session.instructions,
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
      previous.toolVersion === 2 &&
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
            baseInstructions: session.instructions,
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
      toolVersion: 2,
      status: "ready",
    })
    diagnostic("codex.session", { threadId, resumed })
    let toolCount = 0
    let sequence = Promise.resolve()
    client.onRequest = async (method, params) => {
      if (method !== "item/tool/call")
        throw new Error("Only tutoring tools are available.")
      const call = CallSchema.parse(params)
      diagnostic("tool.call", { tool: call.tool, threadId: call.threadId })
      if (call.threadId !== threadId)
        throw new Error("Invalid tutoring thread.")
      if (++toolCount > 48)
        throw new Error("The runner reached its tool limit.")
      const operation = sequence.then(() =>
        session.execute(call.tool, call.arguments),
      )
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
    client.notifications.on(
      "item/completed",
      (raw: z.infer<ReturnType<typeof z.json>>) => {
        const item = ItemSchema.safeParse(raw)
        if (!item.success || item.data.threadId !== threadId) return
        if (
          item.data.item.type === "agentMessage" &&
          item.data.item.phase !== "commentary"
        )
          reply = item.data.item.text ?? reply
      },
    )
    let input = `Continue this tutoring conversation from the saved handoff. The last entry is the current learner request.\n${JSON.stringify(job.chat.messages.map(({ role, content }) => ({ role, content })))}`
    if (resumed) {
      const request = job.chat.messages.at(-1)
      if (!request || request.role !== "user") throw new Error("The current learner request is missing.")
      input = request.content
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      reply = ""
      const completion = client.waitFor(
        "turn/completed",
        TurnSchema.refine((event) => event.threadId === threadId),
      )
      void completion.promise.catch(() => {})
      try {
        if (attempt === 0) activity("Preparing your lesson with Codex")
        else activity("Completing study notes with Codex")
        diagnostic("turn.start", {
          attempt: attempt + 1,
          recovery: attempt > 0,
        })
        await client.request(
          "turn/start",
          {
            threadId,
            input: [{ type: "text", text: input }],
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
          attempt: attempt + 1,
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
        if (session.saved && reply.trim()) return { ...session.finish(reply), providerSession }
        if (!session.saved) {
          input =
            "Complete the current learner request without advancing the lesson. Call save_learning_state with the complete notes, private handoff, and next action, then provide the learner-facing reply. The previous reply has not been shown or saved."
          if (session.saveError)
            input += `\nCorrect this rejected save: ${session.saveError}`
        } else {
          input =
            "The learning state is staged, but the learner-facing reply is missing. Provide the explanation, question, or plan for this same learner request without advancing the lesson."
        }
      } finally {
        completion.dispose()
      }
    }
    if (!session.saved && !session.saveError)
      throw new Error(
        `Codex did not save a complete learning state after 3 attempts (${toolCount} tutoring tool calls). Open Diagnostics to inspect the turn trace.`,
      )
    return { ...session.finish(reply), providerSession }
  } finally {
    client.close()
    processChanged(null)
  }
}
