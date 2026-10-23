import type { Diagnostic, WorkerJob } from "../shared/contracts"
import type { TurnTelemetry } from "./telemetry"

export async function runAgentTurn<Result>(options: {
  limit: number
  run: (attempt: number) => Promise<void>
  ready: () => boolean
  recover: () => void
  finish: () => Result
  exhausted: () => Error
  diagnostic?: Diagnostic
  telemetry?: TurnTelemetry
  runner?: Pick<WorkerJob["runner"], "provider" | "model">
}) {
  const step = <Value>(name: string, operation: () => Value | Promise<Value>) => {
    options.diagnostic?.("turn.step", { step: name })
    if (options.telemetry) return options.telemetry.span(`turn.${name}`, "CHAIN", operation)
    return operation()
  }

  for (let attempt = 1; attempt <= options.limit; attempt++) {
    await step("agent", async () => {
      if (options.telemetry && options.runner) {
        await options.telemetry.span(`runner.${options.runner.provider}`, "AGENT",
          () => options.run(attempt), { "llm.model_name": options.runner.model, "edu.attempt": attempt })
      } else await options.run(attempt)
    })
    const ready = await step("validate", () => {
      if (options.ready()) return true
      options.telemetry?.reject()
      return false
    })
    if (ready) return step("finish", options.finish)
    if (attempt < options.limit) await step("recover", options.recover)
  }

  throw options.exhausted()
}
