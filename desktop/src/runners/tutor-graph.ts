import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import { z } from "zod"
import type { Diagnostic } from "../shared/contracts"
import type { TurnTelemetry } from "./telemetry"
import { isScratchpadReadTool } from "./scratchpad-tools"
import { TutorPublicationError } from "./publication-error"
import type { createTutorSession } from "./tutor"

type TutorSession = Awaited<ReturnType<typeof createTutorSession>>

export const TutorToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  arguments: z.string(),
})
const ModelResponseSchema = z.object({
  reply: z.string(),
  calls: z.array(TutorToolCallSchema),
  finishAfterTools: z.boolean(),
})
const ToolState = Annotation.Root({
  calls: Annotation<z.infer<typeof TutorToolCallSchema>[]>({ reducer: (_previous, next) => next, default: () => [] }),
  results: Annotation<Awaited<ReturnType<TutorSession["execute"]>>[]>({ reducer: (_previous, next) => next, default: () => [] }),
})
const TurnState = Annotation.Root({
  ...ToolState.spec,
  attempt: Annotation<number>({ reducer: (_previous, next) => next, default: () => 0 }),
  reply: Annotation<string>({ reducer: (_previous, next) => next, default: () => "" }),
  finishAfterTools: Annotation<boolean>({ reducer: (_previous, next) => next, default: () => false }),
  ready: Annotation<boolean>({ reducer: (_previous, next) => next, default: () => false }),
  result: Annotation<ReturnType<TutorSession["finish"]> | null>({ reducer: (_previous, next) => next, default: () => null }),
})

type ConsumeTools = (calls: typeof ToolState.State.calls, results: typeof ToolState.State.results) => void | Promise<void>

export function createTutorToolGraph(session: TutorSession, diagnostic: Diagnostic = () => {}, consumeTools: ConsumeTools = () => {}) {
  return new StateGraph(ToolState)
    .addNode("execute_tools", async (state) => {
      diagnostic("graph.node", { node: "execute_tools", calls: state.calls.length })
      const results: typeof ToolState.State.results = []
      // Tool order matters: activation precedes questions, and a rejected write must invalidate publication.
      for (const call of state.calls) {
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
      await consumeTools(state.calls, results)
      return { results }
    })
    .addEdge(START, "execute_tools")
    .addEdge("execute_tools", END)
    .compile()
}

export function createTutorGraph({ session, model, consumeTools, recover, maxAttempts, exhausted, telemetry, diagnostic = () => {} }: {
  session: TutorSession
  model: (attempt: number) => Promise<z.infer<typeof ModelResponseSchema>>
  consumeTools: ConsumeTools
  recover: (message: string) => void | Promise<void>
  maxAttempts: number
  exhausted: () => Error
  diagnostic?: Diagnostic
  telemetry?: TurnTelemetry
}) {
  // The desktop runner owns tracing; inherited LangSmith settings must not upload its conversations.
  process.env.LANGSMITH_TRACING = "false"
  process.env.LANGCHAIN_TRACING_V2 = "false"
  process.env.LANGCHAIN_TRACING = ""
  const tools = createTutorToolGraph(session, diagnostic, consumeTools)
  return new StateGraph(TurnState)
    .addNode("model", async (state) => {
      diagnostic("graph.node", { node: "model", attempt: state.attempt + 1 })
      let output
      if (telemetry) output = await telemetry.span("graph.model", "AGENT", () => model(state.attempt + 1))
      else output = await model(state.attempt + 1)
      const response = ModelResponseSchema.parse(output)
      return { ...response, attempt: state.attempt + 1, ready: false, results: [] }
    })
    .addNode("tools", tools)
    .addNode("validate", (state) => {
      diagnostic("graph.node", { node: "validate", saved: session.saved })
      diagnostic("tutor.validation", { saved: session.saved, saveError: session.saveError ?? null, emptyReply: !session.hasReply(state.reply) })
      let ready = session.saved && session.hasReply(state.reply)
      if (state.calls.length) {
        ready = ready && state.finishAfterTools && state.results.every((result) => result.success) &&
          !state.calls.some((call) => isScratchpadReadTool(call.name)) && state.calls.at(-1)?.name === "save_learning_state"
      }
      return { ready }
    })
    .addNode("recover", async (state) => {
      diagnostic("graph.node", { node: "recover" })
      await recover(session.recoveryMessage(state.reply))
      return {}
    })
    .addNode("publish", (state) => {
      diagnostic("graph.node", { node: "publish" })
      return { result: session.finish(state.reply) }
    })
    .addNode("exhausted", (state) => {
      diagnostic("graph.node", { node: "exhausted" })
      if (session.saveError) throw new TutorPublicationError(session.saveError)
      throw exhausted()
    })
    .addEdge(START, "model")
    .addConditionalEdges("model", (state) => {
      if (state.calls.length) return "tools"
      return "validate"
    }, ["tools", "validate"])
    .addEdge("tools", "validate")
    .addConditionalEdges("validate", (state) => {
      if (state.ready) return "publish"
      if (state.attempt >= maxAttempts) return "exhausted"
      if (state.calls.length && state.results.every((result) => result.success)) return "model"
      return "recover"
    }, ["publish", "exhausted", "model", "recover"])
    .addEdge("recover", "model")
    .addEdge("publish", END)
    .addEdge("exhausted", END)
    .compile()
}

export async function runTutorGraph(options: Parameters<typeof createTutorGraph>[0]) {
  const graph = createTutorGraph(options)
  const invoke = () => graph.invoke({}, { recursionLimit: options.maxAttempts * 4 + 2 })
  let state
  if (options.telemetry) state = await options.telemetry.span("tutor.graph", "CHAIN", invoke)
  else state = await invoke()
  if (!state.result) throw new Error("The tutoring graph ended without a validated reply.")
  return state.result
}
