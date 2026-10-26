import { randomUUID } from "node:crypto"
import { END, START, Send, StateGraph, StateSchema, type BaseCheckpointSaver } from "@langchain/langgraph"
import { z } from "zod"
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import type { WorkflowHost } from "../main/tutor-workflow"
import { MessageSchema, ProviderSessionSchema, WorkerResultSchema, type WorkerJob } from "../shared/contracts"
import { CompleteOutputSchema, RoleSummarySchema, TutorDecisionSchema } from "../shared/tutor-workflow"
import { createWorkflowRoleSession, createWorkflowTutorSession } from "./workflow-session"
import type { createTutorSession } from "./tutor"
import { committedSource } from "./workflow-context"
import { createTopicHandles } from "./topic-handles"
import { parseScratchpadCommand } from "../shared/scratchpad-commands"
import { scratchpadOperationId } from "../shared/scratchpad-operation"
import { selectTutorTopicIds } from "./tutor-evidence"

export type WorkflowNativeRunner = (job: WorkerJob, session: Awaited<ReturnType<typeof createTutorSession>>, invocationId: string) => Promise<ReturnType<Awaited<ReturnType<typeof createTutorSession>>["finish"]> & { providerSession?: z.infer<typeof ProviderSessionSchema> }>


export function createTutorGraph(repository: WorkflowHost, native: WorkflowNativeRunner, checkpointer: BaseCheckpointSaver, { codex, cli, apiKey }: Partial<Pick<WorkerJob, "codex" | "cli" | "apiKey">>, activity: (message: string) => void = () => {}, budget = { maxInputTokens: 120_000, reserveTokens: 20_000, recentMessages: 8 }) {
  // Worker jobs also contain the original snapshot; only credentials may override checkpointed context.
  const connection = { codex, cli, apiKey }
  const RoleState = new StateSchema({ chatId: z.string().uuid(), turnId: z.string().uuid(), jobId: z.string().uuid(), output: RoleSummarySchema.optional() })
  const roleGraph = new StateGraph(RoleState)
    .addNode("prepare", async ({ chatId, turnId, jobId }) => {
      const turn = await repository.get(chatId, turnId)
      if (!turn.batches.flatMap((batch) => batch.jobs).some((job) => job.jobId === jobId)) throw new Error("Role job not found.")
      return {}
    })
    .addNode("run", async ({ chatId, turnId, jobId }) => {
      const turn = await repository.get(chatId, turnId)
      const role = turn.batches.flatMap((batch) => batch.jobs).find((job) => job.jobId === jobId)!
      if (role.output) return { output: role.output }
      if (role.role === "topic" && role.access === "write" && !role.snapshot?.planConfirmed) {
        const saved = role.operations.findLast((operation) => operation.mutation.type === "createTopic" || operation.mutation.type === "updateTopic")?.mutation
        if (saved?.type === "createTopic") return { output: { summary: "Recovered the staged topic plan for confirmation.", evidence: saved.topic.content.flatMap((part) => part.references) } }
        if (saved?.type === "updateTopic" && saved.content) return { output: { summary: "Recovered the staged topic plan for confirmation.", evidence: saved.content.flatMap((part) => part.references) } }
      }
      const context = await createWorkflowRoleSession({ ...committedSource(turn), ...connection, apiKey: connection.apiKey ?? "" }, role, async (mutation) => {
        const operationId = scratchpadOperationId(role.stageId, mutation)
        await repository.stage(chatId, turnId, jobId, operationId, mutation)
      }, activity, async (id, firstPage, lastPage) => { await repository.recordRead(chatId, turnId, jobId, id, firstPage, lastPage) })
      await native(context.job, context.session, role.jobId)
      if (!context.output) throw new Error("The role did not return a validated summary.")
      return { output: context.output }
    })
    .addNode("validate", async ({ chatId, turnId, jobId, output }) => {
      await repository.ready(chatId, turnId, jobId, RoleSummarySchema.parse(output))
      return {}
    })
    .addEdge(START, "prepare").addEdge("prepare", "run").addEdge("run", "validate").addEdge("validate", END)
    .compile()

  const State = new StateSchema({
    chatId: z.string().uuid(), turnId: z.string().uuid(), contextVersion: z.string().uuid().optional(),
    decision: TutorDecisionSchema.optional(), batchId: z.string().uuid().optional(), jobId: z.string().uuid().optional(),
    completion: CompleteOutputSchema.optional(),
    overBudget: z.boolean().default(false), directPlan: z.boolean().default(false),
    singleTurn: z.boolean().default(false), directResult: WorkerResultSchema.optional(),
  })
  return new StateGraph(State)
    .addNode("route", async ({ chatId, turnId }) => {
      const turn = await repository.get(chatId, turnId)
      const request = turn.source.chat.messages.find((message) => message.id === turn.learnerMessageId)
      const command = parseScratchpadCommand(request?.content ?? "")
      if (command?.type === "topic" && command.instruction && command.instruction.length <= 20_000) {
        const batch = await repository.assumeRole(chatId, turnId, turnId, [{
          target: { mode: "create", type: "topic" }, task: command.instruction, requestedAccess: "write",
          context: { learnerMessageIds: [turn.learnerMessageId], materialIds: turn.source.chat.materials.map((material) => material.id), readDependencies: [], relevantContext: "The learner explicitly requested topic creation. Clarify missing scope before creating a plan." },
        }])
        return { directPlan: true, batchId: batch.batchId }
      }
      if (command || turn.source.chat.scratchpadRequested) return { directPlan: false }
      const source = committedSource(turn)
      const targets = selectTutorTopicIds(source.chat, source.openedTopicId, source.confirmTopicId)
      if (targets.length !== 1) return { directPlan: false }
      const topic = source.topics.find((topic) => topic.id === targets[0] && !topic.archived)
      if (topic?.state?.type !== "topic" || !topic.planConfirmed) return { directPlan: false }
      const summary = turn.summary?.summary ?? ""
      const contextBytes = Buffer.byteLength(JSON.stringify({ messages: source.chat.messages, learning: source.chat.learning, summary }))
      // Leave room for the role's management instructions, current target, and tool schemas.
      if (summary.length > 20_000 || contextBytes > (budget.maxInputTokens - budget.reserveTokens) / 2) return { directPlan: false }
      const handles = createTopicHandles({ ...source, apiKey: "" })
      const batch = await repository.assumeRole(chatId, turnId, turnId, [{
        target: { mode: "existing", scratchpadHandle: handles.handle(topic.id) },
        task: "Handle the latest learner request for this topic. Use the saved handoff and recorded evidence to assess any pending answer and continue the sourced lesson. Honor explicit changes of section or scope. Ask one check when teaching, then save the handoff and reply. If the request needs work outside this target or ungranted dependencies, return it to Tutor with finish_role and needsCoordination before making any writes.",
        requestedAccess: "write", replyToLearner: true,
        context: {
          learnerMessageIds: source.chat.messages.map((message) => message.id),
          materialIds: [...new Set([...source.chat.materials, ...topic.materials].map((material) => material.id))],
          readDependencies: [], relevantContext: summary,
        },
      }])
      return { directPlan: false, batchId: batch.batchId }
    })
    // Retain retired node names so saved turns can recover without running management tools in Tutor.
    .addNode("single_tutor", async ({ chatId, turnId }) => {
      const turn = await repository.get(chatId, turnId)
      const batch = turn.batches.find((batch) => batch.tutorStepId === turnId && !batch.receipt)
      if (batch) {
        await Promise.all(batch.jobs.map((job) => roleGraph.invoke({ chatId, turnId, jobId: job.jobId })))
        await repository.commitBatch(chatId, turnId, batch.batchId)
      }
      return {}
    })
    .addNode("single_publish", async ({ chatId, turnId, batchId, directResult }) => {
      const result = WorkerResultSchema.parse(directResult)
      const turn = await repository.get(chatId, turnId)
      const batch = turn.batches.find((batch) => batch.batchId === batchId)
      if (batch && !batch.receipt) {
        for (const job of batch.jobs) await repository.ready(chatId, turnId, job.jobId, { summary: "Recovered previously generated tutoring output.", evidence: [] })
        await repository.commitBatch(chatId, turnId, batch.batchId)
      }
      const handoff = await repository.saveHandoff(chatId, turnId, turnId, result.learning, result.providerSession)
      await repository.saveReply(chatId, turnId, result.reply, handoff)
      return { completion: await repository.complete(chatId, turnId) }
    })
    .addNode("prepare_context", async ({ chatId, turnId }) => {
      const turn = await repository.get(chatId, turnId)
      const key = `role-isolation-v2:${turn.batches.at(-1)?.batchId ?? "entry"}:${turn.summary?.summaryId ?? "full"}`
      const saved = turn.contexts.find((context) => context.key === key)
      const source = committedSource(turn)
      const { session } = await createWorkflowTutorSession({ ...source, ...connection, apiKey: connection.apiKey ?? "" }, turn.batches.flatMap((batch) => batch.receipt ? [batch.receipt] : []), turn.summary?.summary ?? "", activity)
      const context = saved ?? await repository.saveContext(chatId, turnId, {
        contextVersion: randomUUID(), tutorStepId: randomUUID(), key, source, summary: turn.summary?.summary ?? "", instructions: session.instructions,
        tools: session.tools.map((tool) => {
          if (tool.type !== "function") throw new Error("Unsupported Tutor tool.")
          return ToolSchema.parse({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })
        }),
      })
      // UTF-8 bytes conservatively bound text tokens across provider tokenizers; reserve additional image/result capacity.
      const inputSize = Buffer.byteLength(JSON.stringify({ instructions: context.instructions, tools: context.tools, messages: context.source.chat.messages }))
      const imageReserve = context.source.chat.materials.filter((material) => material.kind === "image").length * 12_000
      return { contextVersion: context.contextVersion, overBudget: inputSize + imageReserve > budget.maxInputTokens - budget.reserveTokens }
    })
    .addNode("compact_history", async ({ chatId, turnId, contextVersion }) => {
      const turn = await repository.get(chatId, turnId)
      const context = turn.contexts.find((context) => context.contextVersion === contextVersion)!
      const eligible = context.source.chat.messages.slice(0, -Math.max(1, budget.recentMessages))
      if (!eligible.length) throw new Error("Required instructions, tools, or recent context exceed the input budget. Narrow the current content before retrying.")
      activity("Summarizing earlier conversation")
      const job = { ...context.source, ...connection, apiKey: connection.apiKey ?? "", chat: { ...context.source.chat, messages: eligible, materials: [] } }
      const { session: base } = await createWorkflowTutorSession(job, [], context.summary, activity)
      const session = { ...base,
        instructions: `Summarize this conversation for continuation. Preserve learning objectives, pending questions, learner preferences, decisions, and unresolved work. Keep the summary concise. Do not invent progress or assessment answers. Structured learner and scratchpad state remain authoritative. Return only the summary.\nPrevious summary: ${context.summary}`,
        tools: [], get saved() { return true }, hasReply(reply: string) { return reply.trim().length > 0 },
        async readMessageImages() { return [] },
        async execute() { return { success: false, text: "No tools are available while summarizing.", images: [] } },
        finish(reply: string) { return { reply: MessageSchema.shape.content.trim().min(1).max(30_000).parse(reply), learning: job.chat.learning, topicUpdates: [], topicMutations: [] } },
      }
      const result = await native(job, session, `${context.tutorStepId}:summary`)
      const before = Buffer.byteLength(JSON.stringify(eligible))
      if (Buffer.byteLength(result.reply) >= before) throw new Error("Compaction did not reduce the eligible history. Narrow the current content before retrying.")
      await repository.saveSummary(chatId, turnId, eligible.map((message) => message.id), result.reply)
      return {}
    })
    .addNode("tutor", async ({ chatId, turnId, contextVersion }) => {
      const turn = await repository.get(chatId, turnId)
      const context = turn.contexts.find((context) => context.contextVersion === contextVersion)
      if (!context) throw new Error("Prepared Tutor context not found.")
      const job = { ...context.source, ...connection, apiKey: connection.apiKey ?? "" }
      const priorMutations = turn.batches.filter((batch) => batch.receipt).flatMap((batch) => batch.jobs.flatMap((job) => job.operations.map((operation) => operation.mutation)))
      const tutor = await createWorkflowTutorSession(job, turn.batches.flatMap((batch) => batch.receipt ? [batch.receipt] : []), context.summary, activity, priorMutations)
      if (context.key.startsWith("role-isolation-v2:")) {
        tutor.session.instructions = context.instructions
        tutor.session.tools = context.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
      }
      const result = await native(job, tutor.session, context.tutorStepId)
      if (tutor.requests) return { decision: TutorDecisionSchema.parse({ action: "delegate", requests: tutor.requests }) }
      const handoffRef = await repository.saveHandoff(chatId, turnId, context.tutorStepId, result.learning, result.providerSession)
      return { decision: TutorDecisionSchema.parse({ action: "reply", reply: result.reply, handoffRef }) }
    })
    .addNode("assume_role", async ({ chatId, turnId, contextVersion, decision }) => {
      if (decision?.action !== "delegate") throw new Error("Delegation requests are required.")
      const turn = await repository.get(chatId, turnId)
      const context = turn.contexts.find((context) => context.contextVersion === contextVersion)!
      const batch = await repository.assumeRole(chatId, turnId, context?.tutorStepId ?? turn.learnerMessageId, decision.requests)
      return { batchId: batch.batchId }
    })
    .addNode("topic_role", async (state) => { await roleGraph.invoke({ chatId: state.chatId, turnId: state.turnId, jobId: state.jobId! }); return {} })
    .addNode("test_role", async (state) => { await roleGraph.invoke({ chatId: state.chatId, turnId: state.turnId, jobId: state.jobId! }); return {} })
    .addNode("generic_role", async (state) => { await roleGraph.invoke({ chatId: state.chatId, turnId: state.turnId, jobId: state.jobId! }); return {} })
    .addNode("commit", async ({ chatId, turnId, batchId }) => {
      if (!batchId) throw new Error("Batch identity is required.")
      await repository.commitBatch(chatId, turnId, batchId)
      return {}
    })
    .addNode("present_plan", async ({ chatId, turnId, batchId }) => {
      if (!batchId) throw new Error("A planning batch is required.")
      return { completion: await repository.presentPlan(chatId, turnId, batchId) }
    })
    .addNode("present_role_reply", async ({ chatId, turnId, batchId }) => {
      if (!batchId) throw new Error("A committed response batch is required.")
      return { completion: await repository.presentRoleReply(chatId, turnId, batchId) }
    })
    .addNode("save_reply", async ({ chatId, turnId, decision }) => {
      if (decision?.action !== "reply") throw new Error("A Tutor reply is required.")
      await repository.saveReply(chatId, turnId, decision.reply, decision.handoffRef)
      return {}
    })
    .addNode("complete", async ({ chatId, turnId }) => ({ completion: await repository.complete(chatId, turnId) }))
    .addEdge(START, "route")
    .addConditionalEdges("route", async ({ chatId, turnId, batchId }) => {
      if (!batchId) return "prepare_context"
      const turn = await repository.get(chatId, turnId)
      return turn.batches.find((batch) => batch.batchId === batchId)!.jobs.map((job) => new Send("topic_role", { chatId, turnId, jobId: job.jobId }))
    }, ["prepare_context", "topic_role", "single_tutor", "single_publish"])
    .addEdge("single_tutor", "prepare_context")
    .addEdge("single_publish", "complete")
    .addConditionalEdges("prepare_context", ({ overBudget }) => overBudget ? "compact_history" : "tutor", ["compact_history", "tutor"])
    .addEdge("compact_history", "prepare_context")
    .addConditionalEdges("tutor", ({ decision }) => decision?.action === "delegate" ? "assume_role" : "save_reply", ["assume_role", "save_reply"])
    .addConditionalEdges("assume_role", async ({ chatId, turnId, batchId }) => {
      const turn = await repository.get(chatId, turnId)
      const batch = turn.batches.find((batch) => batch.batchId === batchId)!
      return batch.jobs.map((job) => new Send(`${job.role}_role`, { chatId, turnId, jobId: job.jobId }))
    }, ["topic_role", "test_role", "generic_role"])
    .addEdge("topic_role", "commit").addEdge("test_role", "commit").addEdge("generic_role", "commit")
    .addConditionalEdges("commit", async ({ chatId, turnId, batchId }) => {
      const turn = await repository.get(chatId, turnId)
      const batch = turn.batches.find((batch) => batch.batchId === batchId)!
      if (batch.jobs.every((job) => job.role === "topic" && job.access === "write" && !job.snapshot?.planConfirmed)) return "present_plan"
      if (batch.jobs.length === 1 && batch.jobs[0].request.replyToLearner && batch.jobs[0].output?.response) return "present_role_reply"
      return "prepare_context"
    }, ["present_plan", "present_role_reply", "prepare_context"])
    .addEdge("present_plan", "complete").addEdge("present_role_reply", "complete").addEdge("save_reply", "complete").addEdge("complete", END)
    .compile({ checkpointer })
}
