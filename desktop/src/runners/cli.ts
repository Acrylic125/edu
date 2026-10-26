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

export async function runCliTutorTurn(job: WorkerJob, activity: (message: string) => void, processChanged: (pid: number | null) => void, diagnostic: Diagnostic = () => {}, telemetry?: TurnTelemetry, preparedSession?: Awaited<ReturnType<typeof createTutorSession>>) {
  if (!job.cli) throw new Error("The provider CLI is unavailable.")
  const directory = await mkdtemp(join(job.cli.directory, "turn-"))
  const connection = { ...job.cli, directory }
  try {
    const session = preparedSession ?? await createTutorSession(job, activity, telemetry)
    const currentMessage = job.chat.messages.at(-1)
    if (currentMessage && (await session.readMessageImages(currentMessage)).some((part) => part.type === "image_url"))
      throw new Error("This provider adapter supports extracted text only. Use Codex to inspect image-based source pages.")
    const toolServer = await startTutorToolServer(session, diagnostic, telemetry)
    try {
      await prepareCliWorkspace(connection, true, toolServer)
      const transcript = job.chat.messages.map((message) => ({ role: message.role, content: session.modelText(messageText(message)) }))
      const instructions = `${session.instructions}
Complete the assigned task using the granted EdU MCP tools and the instructions above. Repair rejected operations before finishing. Return JSON containing only reply. Native file and shell tools are disabled.`
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
          const controller = new AbortController()
          let yielded = false
          let running = true
          void session.completion.then(() => {
            if (!running) return
            yielded = true
            controller.abort()
          })
          try {
            const output = await runCliCommand(connection,
              cliPromptArguments(connection, JSON.stringify(z.toJSONSchema(ReplySchema)), job.runner.model, job.runner.reasoningEffort, true, toolServer),
              input, processChanged, 5 * 60_000, controller.signal, toolServer)
            if (!yielded) reply = ReplySchema.parse(parseCliResponse(connection.provider, output)).reply
          } catch (error) {
            if (!yielded || !session.saved) throw error
            diagnostic("turn.yielded", { attempt, saved: true })
          } finally {
            running = false
            await toolServer.drain()
          }
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
