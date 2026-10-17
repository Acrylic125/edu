import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type WorkerJob, type Diagnostic } from "../shared/contracts"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../providers/cli"
import { createTutorSession } from "./tutor"
import { TopicToolNames } from "../shared/topic-state"
import { runTutorGraph } from "./tutor-graph"

const ActionSchema = z.object({
  reply: z.string().max(200_000),
  calls: z.array(z.object({
    name: z.enum(["read_skill", "read_material", "read_topic_notes", "save_learning_state", ...TopicToolNames]),
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
Return JSON with reply and calls. Use calls to request EdU tools; each call has name and arguments (a JSON-encoded string). The harness executes calls and returns their results. Native CLI tools are disabled. Return an empty reply when reading guidance or materials; use their results in the next request. When ready to answer, return the learner-facing reply together with any state updates and save_learning_state as the last call. The harness validates and commits these saves before displaying the reply. Correct rejected saves before finishing. A reply with no calls is also allowed after a successful save.
Available EdU tools: ${JSON.stringify(session.tools)}`
    return await runTutorGraph({
      session,
      maxAttempts: 16,
      diagnostic,
      exhausted: () => new Error("The provider reached its tutoring tool limit. Retry with a narrower request."),
      async model(attempt) {
        activity(`Preparing your lesson with ${connection.provider === "claude" ? "Claude" : "Antigravity"}`)
        diagnostic("cli.request", { provider: connection.provider, iteration: attempt })
        const output = await runCliCommand(connection, cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(ActionSchema)), job.runner.model, job.runner.reasoningEffort), `${instructions}\nConversation and tool results:\n${JSON.stringify(transcript)}`, processChanged)
        const action = ActionSchema.parse(parseCliResponse(connection.provider, output))
        transcript.push(action)
        return { ...action, finishAfterTools: true }
      },
      consumeTools(calls, results) {
        for (const [index, call] of calls.entries()) {
          const result = results[index]
          if (!result) throw new Error("A tutoring tool result is missing.")
          // CLI structured output is text-only; fail explicitly rather than silently ignoring a visual source.
          if (result.images.length)
            throw new Error("This provider adapter supports text and extracted PDF text. Use ChatGPT or OpenRouter for image-based sources.")
          transcript.push({ tool: call.name, result: result.text })
        }
      },
      recover(message) { transcript.push({ role: "user", content: message }) },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
