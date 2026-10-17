import { messageText } from "../shared/message-text"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type WorkerJob, type Diagnostic } from "../shared/contracts"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../providers/cli"
import { createTutorSession } from "./tutor"
import { TopicToolNames } from "../shared/topic-state"
import { runAgentGraph } from "./graph"
import type { TurnTelemetry } from "./telemetry"

const ActionSchema = z.object({
  reply: z.string().max(200_000),
  calls: z.array(z.object({
    name: z.enum(["read_skill", "read_material", "read_topic_notes", "save_learning_state", ...TopicToolNames]),
    arguments: z.string().max(350_000),
  })).max(8),
})

export async function runCliTutorTurn(job: WorkerJob, activity: (message: string) => void, processChanged: (pid: number | null) => void, diagnostic: Diagnostic = () => {}, telemetry?: TurnTelemetry) {
  if (!job.cli) throw new Error("The provider CLI is unavailable.")
  const directory = await mkdtemp(join(job.cli.directory, "turn-"))
  const connection = { ...job.cli, directory }
  try {
    await prepareCliWorkspace(connection)
    const session = await createTutorSession(job, activity, telemetry)
    const transcript: z.infer<ReturnType<typeof z.json>>[] = job.chat.messages.map((message) => ({ role: message.role, content: messageText(message) }))
    const instructions = `${session.instructions}
Return JSON with reply and calls. Use calls to request EdU tools; each call has name and arguments (a JSON-encoded string). The harness executes calls and returns their results. Native CLI tools are disabled. Return an empty reply when reading guidance or materials; use their results in the next request. When ready to answer, return the learner-facing reply together with any state updates and save_learning_state as the last call. The harness validates and commits these saves before displaying the reply. Correct rejected saves before finishing. A reply with no calls is also allowed after a successful save.
Available EdU tools: ${JSON.stringify(session.tools)}`
    let action = ActionSchema.parse({ reply: "", calls: [] })
    return await runAgentGraph({
      limit: 16,
      diagnostic,
      telemetry,
      runner: job.runner,
      async run(iteration) {
        activity(`Preparing your lesson with ${connection.provider === "claude" ? "Claude" : "Antigravity"}`)
        diagnostic("cli.request", { provider: connection.provider, iteration })
        const output = await runCliCommand(connection, cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(ActionSchema)), job.runner.model, job.runner.reasoningEffort), `${instructions}\nConversation and tool results:\n${JSON.stringify(transcript)}`, processChanged)
        action = ActionSchema.parse(parseCliResponse(connection.provider, output))
        transcript.push(action)
        if (action.calls.length) return "tools"
        return "validate"
      },
      async tools() {
        let savesSucceeded = true
        const readsRequested = action.calls.some((call) => call.name === "read_skill" || call.name === "read_material" || call.name === "read_topic_notes" || ["getMistakesForTopic", "whereAmI", "whatIsNext", "getQuestions"].includes(call.name))
        for (const call of action.calls) {
          diagnostic("tool.call", { tool: call.name })
          let input: Parameters<typeof session.execute>[1]
          try {
            input = z.json().parse(JSON.parse(call.arguments))
          } catch {
            // Use shared validation so a rejected save cannot leave an older state publishable.
            input = null
          }
          const result = await session.execute(call.name, input)
          diagnostic("tool.result", { tool: call.name, success: result.success, error: result.success ? null : result.text })
          if (!result.success) savesSucceeded = false
          // CLI structured output is text-only; fail explicitly rather than silently ignoring a visual source.
          if (result.images.length)
            throw new Error("This provider adapter supports text and extracted PDF text. Use ChatGPT or OpenRouter for image-based sources.")
          transcript.push({ tool: call.name, result: result.text })
        }
        if (
          action.reply.trim() &&
          !readsRequested &&
          savesSucceeded &&
          action.calls.at(-1)?.name === "save_learning_state" &&
          session.saved
        ) return "validate"
        return "agent"
      },
      ready: () => session.saved && !!action.reply.trim(),
      recover() {
        transcript.push({ role: "user", content: `Save the complete learning state and provide a learner-facing reply. Correct rejected saves first: ${session.saveError ?? "no complete handoff or reply saved"}` })
      },
      finish: () => session.finish(action.reply),
      exhausted: () => new Error("The provider reached its tutoring tool limit. Retry with a narrower request."),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
