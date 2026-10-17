import { END, START, StateGraph, StateSchema } from "@langchain/langgraph"
import { z } from "zod"
import type { Diagnostic, WorkerJob } from "../shared/contracts"
import type { TurnTelemetry } from "./telemetry"

export async function runAgentGraph<Result>(options: {
  limit: number
  run: (iteration: number) => Promise<"tools" | "validate">
  tools?: () => Promise<"agent" | "validate">
  ready: () => boolean
  recover: () => void
  finish: () => Result
  exhausted: () => Error
  diagnostic?: Diagnostic
  telemetry?: TurnTelemetry
  runner?: Pick<WorkerJob["runner"], "provider" | "model">
}) {
  // This process belongs to EdU's runner; inherited cloud tracing opt-ins must not upload its work.
  process.env.LANGSMITH_TRACING = "false"
  process.env.LANGCHAIN_TRACING_V2 = "false"
  process.env.LANGCHAIN_TRACING = ""
  const node = <Value>(name: string, operation: () => Value | Promise<Value>) => {
    if (options.telemetry) return options.telemetry.span(`graph.${name}`, "CHAIN", operation)
    return operation()
  }
  const state = new StateSchema({
    iteration: z.number().default(0),
    next: z.enum(["agent", "tools", "validate", "recover", "finish"]).default("agent"),
  })
  let result: { value: Result } | undefined
  const graph = new StateGraph(state)
    .addNode("agent", async ({ iteration }) => node("agent", async () => {
      if (iteration >= options.limit) throw options.exhausted()
      options.diagnostic?.("graph.node", { node: "agent", iteration: iteration + 1 })
      let next
      if (options.telemetry && options.runner) {
        const kind = options.runner.provider === "openrouter" ? "LLM" : "AGENT"
        next = await options.telemetry.span(`runner.${options.runner.provider}`, kind,
          () => options.run(iteration + 1), { "llm.model_name": options.runner.model, "edu.attempt": iteration + 1 })
      } else next = await options.run(iteration + 1)
      return { iteration: iteration + 1, next }
    }))
    .addNode("tools", async () => node("tools", async () => {
      if (!options.tools) throw new Error("This agent runner does not expose a tool batch.")
      options.diagnostic?.("graph.node", { node: "tools" })
      return { next: await options.tools() }
    }))
    .addNode("validate", () => node("validate", () => {
      options.diagnostic?.("graph.node", { node: "validate" })
      if (options.ready()) return { next: "finish" as const }
      options.telemetry?.reject()
      return { next: "recover" as const }
    }))
    .addNode("recover", () => node("recover", () => {
      options.diagnostic?.("graph.node", { node: "recover" })
      options.recover()
      return {}
    }))
    .addNode("finish", () => node("finish", () => {
      options.diagnostic?.("graph.node", { node: "finish" })
      result = { value: options.finish() }
      return {}
    }))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", ({ next }) => next, { tools: "tools", validate: "validate" })
    .addConditionalEdges("tools", ({ next }) => next, { agent: "agent", validate: "validate" })
    .addConditionalEdges("validate", ({ next }) => next, { finish: "finish", recover: "recover" })
    .addEdge("recover", "agent")
    .addEdge("finish", END)
    .compile()
  // Each request may pass through tools, validation, and repair before the next request.
  await graph.invoke({}, { recursionLimit: options.limit * 4 + 2 })
  if (!result) throw new Error("The tutoring graph did not produce a result.")
  return result.value
}
