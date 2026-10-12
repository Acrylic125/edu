import { z } from "zod"

export const IdSchema = z.string().uuid()
export const ProviderIdSchema = z.enum(["codex", "claude", "antigravity", "openrouter"])
export const ProviderSettingsSchema = z.object({
  id: ProviderIdSchema,
  displayName: z.string().trim().min(1).max(60),
  binaryPath: z.string().trim().max(4096).default(""),
  enabled: z.boolean().default(false),
})
export const ReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
])
export const ProviderModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  isDefault: z.boolean().default(false),
  reasoningEfforts: z.array(ReasoningEffortSchema).default([]),
  defaultReasoningEffort: ReasoningEffortSchema.optional(),
})
export const ProviderStatusSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  connected: z.boolean(),
  connecting: z.boolean().default(false),
  loading: z.boolean().default(false),
  account: z.string().optional(),
  error: z.string().optional(),
  models: z.array(ProviderModelSchema),
  settings: ProviderSettingsSchema.optional(),
})
export const CodexConnectionSchema = z.object({
  executable: z.string(),
  home: z.string(),
})
export const CliConnectionSchema = z.object({
  provider: z.enum(["claude", "antigravity"]),
  executable: z.string(),
  directory: z.string(),
})
export const RunnerInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  provider: ProviderIdSchema.default("openrouter"),
  reasoningEffort: ReasoningEffortSchema.optional(),
  model: z.string().trim().min(1).max(150).default("openrouter/auto"),
})
export const RunnerSchema = RunnerInputSchema.extend({ id: IdSchema })
export const MessageSchema = z.object({
  id: IdSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().max(200_000),
  createdAt: z.string().datetime(),
})
export const MaterialSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(240)
    .regex(/^[^/\\]+$/),
  kind: z.enum(["text", "pdf", "image"]).default("text"),
  text: z.string().max(300_000),
  pages: z.array(z.string()).max(1000),
})
export const LearningStateSchema = z
  .object({
    phase: z.enum([
      "awaiting_plan_confirmation",
      "ready_to_continue",
      "awaiting_answer",
      "awaiting_choice",
      "paused",
    ]),
    outline: z.array(z.string().max(300)).max(100),
    currentSection: z.string().max(1000),
    pendingQuestion: z.string().max(20_000),
    privateAnswerKey: z.string().max(20_000),
    nextAction: z.string().max(10_000),
    notes: z.string().max(200_000),
    workpad: z.string().max(100_000),
  })
  .superRefine((state, ctx) => {
    if (
      state.phase === "awaiting_answer" &&
      (!state.pendingQuestion || !state.privateAnswerKey)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "An active question needs its exact prompt and a checked private key.",
      })
    }
  })
export const TopicSchema = z.object({
  id: IdSchema,
  title: z.string().max(150),
  titleGenerated: z.boolean().default(false),
  runnerId: IdSchema,
  createdAt: z.string().datetime(),
  planConfirmed: z.boolean(),
  messages: z.array(MessageSchema),
  materials: z.array(MaterialSchema),
  learning: LearningStateSchema,
})
export const WorkspaceSchema = z.object({
  version: z.literal(1),
  runners: z.array(RunnerSchema),
  topics: z.array(TopicSchema),
  providerSettings: z.array(ProviderSettingsSchema).default([]),
})
export const TraceDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
export const TraceEventSchema = z.object({
  time: z.string().datetime(),
  event: z.string().max(100),
  details: TraceDetailsSchema,
})
export type Diagnostic = (
  event: string,
  details: z.infer<typeof TraceDetailsSchema>,
) => void
export const RuntimeSchema = z.object({
  runnerId: IdSchema,
  status: z.enum(["stopped", "ready", "running", "error"]),
  topicId: IdSchema.optional(),
  activity: z.string(),
  error: z.string().optional(),
  pid: z.number().optional(),
  traceId: IdSchema.optional(),
  diagnostics: z.array(TraceEventSchema).max(60).optional(),
})
export const PublicTopicSchema = TopicSchema.omit({
  learning: true,
  materials: true,
}).extend({
  learning: z.object({
    phase: LearningStateSchema.shape.phase,
    outline: z.array(z.string()),
    currentSection: z.string(),
    pendingQuestion: z.string(),
    nextAction: z.string(),
    notes: z.string(),
  }),
  materials: z.array(MaterialSchema.omit({ text: true, pages: true })),
})
export const SnapshotSchema = z.object({
  runners: z.array(RunnerSchema),
  topics: z.array(PublicTopicSchema),
  runtime: z.array(RuntimeSchema),
  connected: z.boolean(),
  providers: z.array(ProviderStatusSchema),
})
export const CreateTopicSchema = z.object({
  runnerId: IdSchema,
  title: z.string().trim().min(1).max(150),
})
export const SendSchema = z.object({
  topicId: IdSchema,
  content: z.string().trim().min(1).max(30_000),
  action: z.enum(["message", "confirm_plan"]).default("message"),
})
export const WorkerJobSchema = z.object({
  topic: TopicSchema,
  runner: RunnerSchema,
  apiKey: z.string().default(""),
  codex: CodexConnectionSchema.optional(),
  cli: CliConnectionSchema.optional(),
  titleModel: ProviderModelSchema.optional(),
  skillDirectory: z.string(),
  assetDirectory: z.string(),
  action: SendSchema.shape.action,
})
export const WorkerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("title"), title: z.string().trim().min(1).max(150) }),
  z.object({ type: z.literal("activity"), activity: z.string() }),
  z.object({
    type: z.literal("trace"),
    event: TraceEventSchema.shape.event,
    details: TraceDetailsSchema,
  }),
  z.object({
    type: z.literal("codex_process"),
    pid: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal("result"),
    reply: z.string().min(1).max(200_000),
    learning: LearningStateSchema,
  }),
  z.object({ type: z.literal("error"), error: z.string() }),
])
export const Channel = {
  snapshot: "prune:snapshot",
  update: "prune:update",
  connect: "prune:connect",
  disconnect: "prune:disconnect",
  cancelConnection: "prune:cancel-connection",
  refreshProviders: "prune:refresh-providers",
  saveProvider: "prune:save-provider",
  updateRunner: "prune:update-runner",
  addRunner: "prune:add-runner",
  removeRunner: "prune:remove-runner",
  startRunner: "prune:start-runner",
  stopRunner: "prune:stop-runner",
  createTopic: "prune:create-topic",
  send: "prune:send",
  importMaterials: "prune:import-materials",
  exportNotes: "prune:export-notes",
  openDiagnostics: "prune:open-diagnostics",
  openWorkspace: "prune:open-workspace",
} as const

export type Snapshot = z.infer<typeof SnapshotSchema>
export type Workspace = z.infer<typeof WorkspaceSchema>
export type Topic = z.infer<typeof TopicSchema>
export type LearningState = z.infer<typeof LearningStateSchema>
export type WorkerJob = z.infer<typeof WorkerJobSchema>
export type DesktopBridge = {
  snapshot: () => Promise<Snapshot>
  subscribe: (listener: (snapshot: Snapshot) => void) => () => void
  connect: (provider?: z.infer<typeof ProviderIdSchema>) => Promise<void>
  disconnect: (provider?: z.infer<typeof ProviderIdSchema>) => Promise<void>
  cancelConnection: (
    provider: z.infer<typeof ProviderIdSchema>,
  ) => Promise<void>
  refreshProviders: () => Promise<void>
  saveProvider: (input: z.input<typeof ProviderSettingsSchema>) => Promise<void>
  updateRunner: (
    id: string,
    input: z.input<typeof RunnerInputSchema>,
  ) => Promise<void>
  addRunner: (input: z.input<typeof RunnerInputSchema>) => Promise<string>
  removeRunner: (id: string) => Promise<void>
  startRunner: (id: string) => Promise<void>
  stopRunner: (id: string) => Promise<void>
  createTopic: (input: z.infer<typeof CreateTopicSchema>) => Promise<string>
  send: (input: z.input<typeof SendSchema>) => Promise<void>
  importMaterials: (topicId: string) => Promise<void>
  exportNotes: (topicId: string) => Promise<void>
  openDiagnostics: (topicId: string) => Promise<void>
  openWorkspace: (topicId: string) => Promise<void>
}
