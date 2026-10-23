import { messageText } from "../shared/message-text"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type WorkerJob, type Diagnostic } from "../shared/contracts"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../providers/cli"
import { createTutorSession } from "./tutor"
import { runAgentTurn } from "./agent-turn"
import { startTutorToolServer } from "./tutor-mcp"
import { TutorPublicationError } from "./publication-error"
import type { TurnTelemetry } from "./telemetry"

const ReplySchema = z.object({ reply: z.string().max(200_000) }).strict()

export async function runCliTutorTurn(job: WorkerJob, activity: (message: string) => void, processChanged: (pid: number | null) => void, diagnostic: Diagnostic = () => {}, telemetry?: TurnTelemetry) {
  if (!job.cli) throw new Error("The provider CLI is unavailable.")
  const directory = await mkdtemp(join(job.cli.directory, "turn-"))
  const connection = { ...job.cli, directory }
  try {
    const session = await createTutorSession(job, activity, telemetry)
    const toolServer = await startTutorToolServer(session, diagnostic, telemetry)
    try {
      await prepareCliWorkspace(connection, true, toolServer)
      const transcript = job.chat.messages.map((message) => ({ role: message.role, content: session.modelText(messageText(message)) }))
      const instructions = `${session.instructions}
Use the EdU MCP tools during your native turn to read sources and update scratchpads. Save the private handoff with save_learning_state before returning the reply. Repair rejected tool operations before finishing. Return JSON containing only reply. Native file and shell tools are disabled.`
      let input = `${instructions}\nConversation:\n${JSON.stringify(transcript)}`
      let reply = ""
      return await runAgentTurn({
        limit: 3,
        diagnostic,
        telemetry,
        runner: job.runner,
        async run(attempt) {
          toolServer.beginAttempt()
          activity(`Preparing your lesson with ${connection.provider === "claude" ? "Claude" : "Antigravity"}`)
          diagnostic("cli.request", { provider: connection.provider, attempt })
          const output = await runCliCommand(connection,
            cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(ReplySchema)), job.runner.model, job.runner.reasoningEffort, true, toolServer),
            input, processChanged, 5 * 60_000, undefined, toolServer)
          await toolServer.drain()
          reply = ReplySchema.parse(parseCliResponse(connection.provider, output)).reply
        },
        ready() {
          diagnostic("tutor.validation", { saved: session.saved, saveError: session.saveError ?? null, emptyReply: !session.hasReply(reply) })
          return session.saved && session.hasReply(reply)
        },
        recover() {
          input = `${instructions}\nConversation:\n${JSON.stringify(transcript)}\n${session.recoveryMessage(reply)}\nRead the current scratchpads before repairing edits. Successful writes from the previous attempt remain staged.`
        },
        finish: () => session.finish(reply),
        exhausted: () => new TutorPublicationError(session.saveError ?? "The provider did not save a complete handoff and reply after 3 attempts."),
      })
    } finally {
      await toolServer.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
