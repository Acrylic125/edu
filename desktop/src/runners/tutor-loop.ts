import { z } from "zod"
import type { Diagnostic } from "../shared/contracts"
import type { TurnTelemetry } from "./telemetry"
import { isScratchpadReadTool } from "./scratchpad-tools"
import { TutorPublicationError } from "./publication-error"
import type { createTutorSession } from "./tutor"

type TutorSession = Awaited<ReturnType<typeof createTutorSession>>

const TutorToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  arguments: z.string(),
})
const ModelResponseSchema = z.object({
  reply: z.string(),
  calls: z.array(TutorToolCallSchema),
  finishAfterTools: z.boolean(),
})

export async function executeTutorTools(session: TutorSession, calls: z.infer<typeof TutorToolCallSchema>[], diagnostic: Diagnostic = () => {}) {
  diagnostic("turn.step", { step: "execute_tools", calls: calls.length })
  const results: Awaited<ReturnType<TutorSession["execute"]>>[] = []
  // Tool order matters: activation precedes questions, and a rejected write must invalidate publication.
  for (const call of calls) {
    diagnostic("tool.call", { tool: call.name })
    let input: z.infer<ReturnType<typeof z.json>> = null
    try {
      input = z.json().parse(JSON.parse(call.arguments))
    } catch {
      // The shared validator must see malformed saves so an older successful save cannot remain publishable.
    }
    const result = await session.execute(call.name, input)
    diagnostic("tool.result", { tool: call.name, success: result.success, error: result.success ? null : result.text })
    results.push(result)
  }
  return results
}

export async function runTutorLoop({ session, model, consumeTools, recover, maxAttempts, exhausted, telemetry, diagnostic = () => {} }: {
  session: TutorSession
  model: (attempt: number) => Promise<z.infer<typeof ModelResponseSchema>>
  consumeTools: (calls: z.infer<typeof TutorToolCallSchema>[], results: Awaited<ReturnType<typeof executeTutorTools>>) => void | Promise<void>
  recover: (message: string) => void | Promise<void>
  maxAttempts: number
  exhausted: () => Error
  diagnostic?: Diagnostic
  telemetry?: TurnTelemetry
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    diagnostic("turn.step", { step: "model", attempt })
    let output
    if (telemetry) output = await telemetry.span("turn.model", "AGENT", () => model(attempt))
    else output = await model(attempt)
    const response = ModelResponseSchema.parse(output)
    const { calls, reply, finishAfterTools } = response
    let results: Awaited<ReturnType<typeof executeTutorTools>> = []
    if (calls.length) {
      results = await executeTutorTools(session, calls, diagnostic)
      await consumeTools(calls, results)
    }

    diagnostic("turn.step", { step: "validate", saved: session.saved })
    diagnostic("tutor.validation", { saved: session.saved, saveError: session.saveError ?? null, emptyReply: !session.hasReply(reply) })
    let ready = session.saved && session.hasReply(reply)
    if (calls.length) {
      ready = ready && finishAfterTools && results.every((result) => result.success) &&
        !calls.some((call) => isScratchpadReadTool(call.name)) && calls.at(-1)?.name === "save_learning_state"
    }
    if (ready) {
      diagnostic("turn.step", { step: "publish" })
      return session.finish(reply)
    }
    if (attempt === maxAttempts) break
    if (calls.length && results.every((result) => result.success)) continue

    diagnostic("turn.step", { step: "recover" })
    await recover(session.recoveryMessage(reply))
  }

  diagnostic("turn.step", { step: "exhausted" })
  if (session.saveError) throw new TutorPublicationError(session.saveError)
  throw exhausted()
}
