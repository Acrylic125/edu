import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { LearningStateSchema, type WorkerJob, type Diagnostic } from "../shared/contracts"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../providers/cli"
import { createTutorSession } from "./tutor"

const ActionSchema = z.object({
  reply: z.string().max(200_000),
  calls: z.array(z.object({
    name: z.enum(["read_skill", "read_material", "save_topic_state", "revise_topic_state", "save_learning_state", "save_behaviour_memory"]),
    arguments: z.string().max(350_000),
  })).max(8),
})

export async function runCliTutorTurn(job: WorkerJob, activity: (message: string) => void, processChanged: (pid: number | null) => void, diagnostic: Diagnostic = () => {}) {
  if (!job.cli) throw new Error("The provider CLI is unavailable.")
  const directory = await mkdtemp(join(job.cli.directory, "turn-"))
  const connection = { ...job.cli, directory }
  try {
    await prepareCliWorkspace(connection)
    const session = await createTutorSession(job, activity)
    const transcript: z.infer<ReturnType<typeof z.json>>[] = job.chat.messages.map(({ role, content }) => ({ role, content }))
    const instructions = `${session.instructions}
Return JSON with reply and calls. Use calls to request EdU tools; each call has name and arguments (a JSON-encoded string). The harness executes calls and returns their results. Native CLI tools are disabled. Return an empty reply while requesting tools, then return a learner-facing reply with no calls after a successful save.
Available EdU tools: ${JSON.stringify(session.tools)}`
    for (let iteration = 0; iteration < 16; iteration++) {
      activity(`Preparing your lesson with ${connection.provider === "claude" ? "Claude" : "Antigravity"}`)
      diagnostic("cli.request", { provider: connection.provider, iteration: iteration + 1 })
      const output = await runCliCommand(connection, cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(ActionSchema)), job.runner.model, job.runner.reasoningEffort), `${instructions}\nConversation and tool results:\n${JSON.stringify(transcript)}`, processChanged)
      const action = ActionSchema.parse(parseCliResponse(connection.provider, output))
      transcript.push(action)
      if (!action.calls.length) {
        if (session.saved) return session.finish(action.reply)
        transcript.push({ role: "user", content: `Save the complete learning state before returning the final reply. Correct rejected saves first: ${session.saveError ?? "no complete handoff saved"}` })
        continue
      }
      for (const call of action.calls) {
        diagnostic("tool.call", { tool: call.name })
        let result
        try {
          result = await session.execute(call.name, z.json().parse(JSON.parse(call.arguments)))
        } catch {
          result = { text: "Tool error: Invalid JSON arguments.", images: [], success: false }
        }
        diagnostic("tool.result", { tool: call.name, success: result.success })
        // CLI structured output is text-only; fail explicitly rather than silently ignoring a visual source.
        if (result.images.length)
          throw new Error("This provider adapter supports text and extracted PDF text. Use ChatGPT or OpenRouter for image-based sources.")
        transcript.push({ tool: call.name, result: result.text })
      }
    }
    throw new Error("The provider reached its tutoring tool limit. Retry with a narrower request.")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
