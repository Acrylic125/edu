import { z } from "zod"
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { IdSchema, LearningStateSchema, MessageSchema, ProviderSessionSchema, TopicSchema, WorkerJobSchema, WorkerResultSchema } from "./contracts"
import { ScratchpadMutationSchema, ScratchpadTypeSchema } from "./scratchpad-state"
import { TopicReferenceSchema } from "./topic-state"

const HandleSchema = z.string().regex(/^scratchpad_[1-9][0-9]*$/)
export const RoleRequestSchema = z.object({
  target: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), scratchpadHandle: HandleSchema }).strict(),
    z.object({ mode: z.literal("create"), type: ScratchpadTypeSchema }).strict(),
  ]),
  task: z.string().trim().min(1).max(20_000),
  requestedAccess: z.enum(["read", "write"]),
  replyToLearner: z.boolean().optional().describe("Complete this learner turn in the role and return its final reply and private handoff. Use only for one independent write job with no remaining coordination."),
  context: z.object({
    learnerMessageIds: z.array(IdSchema), materialIds: z.array(IdSchema),
    readDependencies: z.array(HandleSchema), relevantContext: z.string().max(20_000),
  }).strict(),
}).strict()
export const RoleSummarySchema = z.object({
  summary: z.string().trim().min(1).max(20_000), evidence: z.array(TopicReferenceSchema).max(1000),
  needsClarification: z.boolean().optional().describe("True when missing scope or reliable sources prevent creation. Return the specific gap to Tutor without creating a topic."),
  needsCoordination: z.boolean().optional().describe("Return an existing-target request to Tutor when it needs creation, another target, or ungranted dependencies. Set before making any writes and summarize the requested action."),
  response: WorkerResultSchema.pick({ reply: true, learning: true }).optional(),
}).strict()
export const RoleJobSchema = z.object({
  jobId: IdSchema, stageId: IdSchema, scratchpadId: IdSchema, scratchpadHandle: HandleSchema,
  role: ScratchpadTypeSchema, access: z.enum(["read", "write"]), mode: z.enum(["existing", "create"]),
  baseVersion: z.string().nullable(), snapshot: TopicSchema.nullable(),
  request: RoleRequestSchema,
  dependencies: z.array(TopicSchema).default([]),
  handleIds: z.array(IdSchema).default([]),
  readEvidence: z.array(z.object({ materialId: IdSchema, page: z.number().int().positive() })).default([]),
  operations: z.array(z.object({ operationId: z.string().min(1), mutation: ScratchpadMutationSchema })),
  status: z.enum(["working", "ready", "committed"]).default("working"),
  output: RoleSummarySchema.optional(),
  committedSnapshot: TopicSchema.optional(),
})
export const BatchReceiptSchema = z.object({
  receiptId: IdSchema, batchId: IdSchema, committedAt: z.iso.datetime(),
  results: z.array(RoleSummarySchema.omit({ response: true }).extend({ jobId: IdSchema, scratchpadId: IdSchema, scratchpadHandle: HandleSchema, role: ScratchpadTypeSchema, version: z.string() })),
})
export const RoleBatchSchema = z.object({
  batchId: IdSchema, tutorStepId: IdSchema, jobs: z.array(RoleJobSchema), receipt: BatchReceiptSchema.optional(),
})
export const HandoffRecordSchema = z.object({
  handoffId: IdSchema, tutorStepId: IdSchema, learning: LearningStateSchema, batchIds: z.array(IdSchema),
})
export const TurnReceiptSchema = z.object({
  receiptId: IdSchema, messageId: IdSchema, handoffRef: IdSchema,
  committedBatchReceiptIds: z.array(IdSchema), committedAt: z.iso.datetime(),
})
export const CompleteOutputSchema = z.object({ receipt: TurnReceiptSchema, message: MessageSchema })

export const WorkflowSourceSchema = WorkerJobSchema.omit({ apiKey: true, codex: true, cli: true, telemetry: true, workflow: true })
export const PreparedContextSchema = z.object({
  contextVersion: IdSchema, tutorStepId: IdSchema, key: z.string(),
  source: WorkflowSourceSchema, summary: z.string(), instructions: z.string(),
  tools: z.array(ToolSchema),
})
export const TutorDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delegate"), requests: z.array(RoleRequestSchema).min(1).max(12) }),
  z.object({ action: z.literal("reply"), reply: z.string().trim().min(1).max(200_000), handoffRef: IdSchema }),
])
export const ConversationSummarySchema = z.object({
  summaryId: IdSchema, chatId: IdSchema, coveredThroughMessageId: IdSchema,
  sourceMessageIds: z.array(IdSchema).min(1), summary: z.string().trim().min(1).max(30_000), createdAt: z.iso.datetime(),
})
export const WorkflowRecordSchema = z.object({
  turnId: IdSchema,
  chatId: IdSchema,
  learnerMessageId: IdSchema,
  status: z.enum(["running", "failed", "completed"]),
  attemptId: IdSchema,
  error: z.string().optional(),
  source: WorkflowSourceSchema,
  batches: z.array(RoleBatchSchema).default([]),
  handoffs: z.array(HandoffRecordSchema).default([]),
  receipt: TurnReceiptSchema.optional(),
  providerSession: ProviderSessionSchema.optional(),
  contexts: z.array(PreparedContextSchema).default([]),
  summary: ConversationSummarySchema.optional(),
  nativeProcesses: z.array(z.object({ invocationId: z.string(), pid: z.number().int().positive(), identity: z.string() })).default([]),
  nativeInvocations: z.array(z.object({ invocationId: z.string(), attemptId: IdSchema, status: z.enum(["active", "completed", "uncertain", "reconciled"]), registered: z.boolean() })).default([]),
})

const TurnKeySchema = z.object({ chatId: IdSchema, turnId: IdSchema })
export const WorkflowRequestSchema = z.discriminatedUnion("operation", [
  TurnKeySchema.extend({ operation: z.literal("get") }),
  TurnKeySchema.extend({ operation: z.literal("beginInvocation"), invocationId: z.string() }),
  TurnKeySchema.extend({ operation: z.literal("endInvocation"), invocationId: z.string(), completed: z.boolean() }),
  TurnKeySchema.extend({ operation: z.literal("assumeRole"), tutorStepId: IdSchema, requests: z.array(RoleRequestSchema).min(1).max(12) }),
  TurnKeySchema.extend({ operation: z.literal("stage"), jobId: IdSchema, operationId: z.string().min(1), mutation: ScratchpadMutationSchema }),
  TurnKeySchema.extend({ operation: z.literal("recordRead"), jobId: IdSchema, materialId: IdSchema, firstPage: z.number().int().positive(), lastPage: z.number().int().positive() }),
  TurnKeySchema.extend({ operation: z.literal("ready"), jobId: IdSchema, output: RoleSummarySchema }),
  TurnKeySchema.extend({ operation: z.literal("commitBatch"), batchId: IdSchema }),
  TurnKeySchema.extend({ operation: z.literal("presentPlan"), batchId: IdSchema }),
  TurnKeySchema.extend({ operation: z.literal("presentRoleReply"), batchId: IdSchema }),
  TurnKeySchema.extend({ operation: z.literal("saveHandoff"), tutorStepId: IdSchema, learning: LearningStateSchema, providerSession: ProviderSessionSchema.optional() }),
  TurnKeySchema.extend({ operation: z.literal("saveReply"), reply: z.string().min(1).max(200_000), handoffRef: IdSchema }),
  TurnKeySchema.extend({ operation: z.literal("complete") }),
  TurnKeySchema.extend({ operation: z.literal("saveContext"), context: PreparedContextSchema }),
  TurnKeySchema.extend({ operation: z.literal("saveSummary"), sourceMessageIds: z.array(IdSchema).min(1), summary: z.string().min(1).max(30_000) }),
])
export const WorkflowResponseSchema = z.object({
  type: z.literal("workflow_response"), requestId: IdSchema, result: z.json().optional(), error: z.string().optional(),
})
