import { END, START, StateGraph, StateSchema } from "@langchain/langgraph"
import { z } from "zod"
import type { createTutorSession } from "./tutor"

// The native provider owns its tool loop, so this graph must finish before a tool result returns.
export function createTopicToolWorkflow(base: Awaited<ReturnType<typeof createTutorSession>>) {
  const State = new StateSchema({ name: z.string(), input: z.json(), text: z.string().default(""), success: z.boolean().default(false), completed: z.array(z.string()).default([]) })
  const graph = new StateGraph(State)
    .addNode("reconcile_saved_assessments", async () => ({ completed: await base.reconcileTopicProgress() }))
    .addNode("apply_tool", async ({ name, input }) => {
      const result = await base.execute(name, input)
      return { text: result.text, success: result.success }
    })
    .addNode("apply_assessment_completion", async ({ name, success, completed }) => {
      if (success && (name === "topic_recordAnswer" || name === "topic_activatePart" || name === "topic_updateTopic"))
        return { completed: [...completed, ...await base.reconcileTopicProgress()] }
      return {}
    })
    .addEdge(START, "reconcile_saved_assessments")
    .addEdge("reconcile_saved_assessments", "apply_tool")
    .addEdge("apply_tool", "apply_assessment_completion")
    .addEdge("apply_assessment_completion", END)
    .compile()
  return async (name: string, input: Parameters<typeof base.execute>[1]) => {
    const result = await graph.invoke({ name, input: z.json().parse(JSON.parse(JSON.stringify(input))) })
    let text = result.text
    if (result.completed.length) text += `\nHost completed parts from all required criterion assessments: ${result.completed.join(", ")}. Choose continuation from this updated state; do not ask an extra check to complete these parts.`
    if (result.success && name === "topic_updateTopic")
      text += "\nCurriculum scope changed. Choose the next active or untouched part from this updated state. Removed parts are historical only. Save a fresh handoff; do not reuse a removed or changed check."
    return { success: result.success, text, images: [] }
  }
}
