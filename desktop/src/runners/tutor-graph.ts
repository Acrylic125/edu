import { Annotation, END, START, StateGraph } from "@langchain/langgraph"
import { z } from "zod"
import type { Diagnostic } from "../shared/contracts"
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
const readTools = new Set(["read_skill", "read_material", "read_topic_notes", "getQuestions", "getMistakesForTopic", "whereAmI", "whatIsNext"])

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

export function createTutorGraph({ session, model, consumeTools, recover, maxAttempts, exhausted, diagnostic = () => {} }: {
  session: TutorSession
  model: (attempt: number) => Promise<z.infer<typeof ModelResponseSchema>>
  consumeTools: ConsumeTools
  recover: (message: string) => void | Promise<void>
  maxAttempts: number
  exhausted: () => Error
  diagnostic?: Diagnostic
}) {
  const tools = createTutorToolGraph(session, diagnostic, consumeTools)
  return new StateGraph(TurnState)
    .addNode("model", async (state) => {
      diagnostic("graph.node", { node: "model", attempt: state.attempt + 1 })
      const response = ModelResponseSchema.parse(await model(state.attempt + 1))
      return { ...response, attempt: state.attempt + 1, ready: false, results: [] }
    })
    .addNode("tools", tools)
    .addNode("validate", (state) => {
      diagnostic("graph.node", { node: "validate", saved: session.saved })
      let ready = session.saved && state.reply.trim().length > 0
      if (state.calls.length) {
        ready = ready && state.finishAfterTools && state.results.every((result) => result.success) &&
          !state.calls.some((call) => readTools.has(call.name)) && state.calls.at(-1)?.name === "save_learning_state"
      }
      return { ready }
    })
    .addNode("recover", async () => {
      diagnostic("graph.node", { node: "recover" })
      let message = "State staged. Reply to the current learner request without advancing the lesson."
      if (!session.saved) {
        message = "Reply not published. Stay on the current request.\n1. Repair rejected writes with their original tool and target.\n2. Save the private handoff with save_learning_state. This does not repair topic writes.\n3. Provide the learner-facing reply."
        if (session.saveError) message += `\nCorrect rejected saves first: ${session.saveError}`
      }
      await recover(message)
      return {}
    })
    .addNode("publish", (state) => {
      diagnostic("graph.node", { node: "publish" })
      return { result: session.finish(state.reply) }
    })
    .addNode("exhausted", () => {
      diagnostic("graph.node", { node: "exhausted" })
      if (session.saveError) throw new Error(session.saveError)
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
  const state = await graph.invoke({}, { recursionLimit: options.maxAttempts * 4 + 2 })
  if (!state.result) throw new Error("The tutoring graph ended without a validated reply.")
  return state.result
}
