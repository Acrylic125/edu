import { z } from "zod"
import { DocumentIndexSchema } from "./document-index"
import { TopicPartSchema } from "./topic-state"
import { ScratchpadStateSchema, ScratchpadMutationSchema } from "./scratchpad-state"

export const IdSchema = z.string().uuid()
export const ProviderIdSchema = z.enum(["codex", "claude", "antigravity"])
export const providerDefaultModels = {
  codex: "gpt-6-luna",
  claude: "claude-haiku-5-5",
  antigravity: "gemini-3.8-flash-high",
} satisfies Record<z.infer<typeof ProviderIdSchema>, string>

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
  installed: z.boolean().default(false),
  checkedAt: z.string().datetime().optional(),
  connecting: z.boolean().default(false),
  loading: z.boolean().default(false),
  account: z.string().optional(),
  error: z.string().optional(),
  models: z.array(ProviderModelSchema),
  settings: ProviderSettingsSchema.optional(),
  runtime: z.object({
    executable: z.string(),
    source: z.enum(["installed", "custom"]),
  }).optional(),
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
  provider: ProviderIdSchema.default("codex"),
  reasoningEffort: ReasoningEffortSchema.optional(),
  model: z.string().trim().min(1).max(150).default("default"),
}).overwrite((runner) => {
  if (runner.model !== "default") return runner
  return { ...runner, model: providerDefaultModels[runner.provider] }
})
export const RunnerSchema = RunnerInputSchema.safeExtend({ id: IdSchema })
export const ResponseQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  options: z.array(z.string().trim().min(1).max(1000)).min(2).max(6)
    .refine((options) => new Set(options).size === options.length, "Response options must be distinct."),
})
export const MessageSchema = z.object({
  id: IdSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().max(200_000),
  createdAt: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  responseQuestion: ResponseQuestionSchema.optional(),
  materialIds: z.array(IdSchema).optional(),
  scratchpadIds: z.array(IdSchema).default([]),
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
  documentIndex: DocumentIndexSchema.optional(),
})
export const LearningStateSchema = z
  .object({
    phase: z.enum([
      "awaiting_plan_confirmation",
      "ready_to_continue",
      "awaiting_answer",
      "awaiting_clarification",
      "contested",
      "awaiting_choice",
      "paused",
    ]),
    outline: z.array(TopicPartSchema.shape.name).max(100),
    currentSection: z.string().max(1000),
    pendingQuestion: z.string().max(20_000),
    pendingCheck: z.object({
      scratchpadId: IdSchema,
      scratchpadPartId: TopicPartSchema.shape.id,
      stepIndex: z.number().int().nonnegative(),
    }).optional(),
    privateAnswerKey: z.string().max(20_000),
    responseQuestion: ResponseQuestionSchema.optional().describe("Multiple-choice response UI for the current reply. Supply its prompt and options when offering a choice; omit when no choice is pending. This is learner-visible and must contain no answer key."),
    nextAction: z.string().max(10_000),
    notes: z.string().max(200_000),
    workpad: z.string().max(100_000),
  })
  .superRefine((state, ctx) => {
    if (
      (["awaiting_answer", "contested"].includes(state.phase) || (state.phase === "awaiting_clarification" && state.pendingCheck)) &&
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
  state: ScratchpadStateSchema.optional(),
  fileError: z.enum(["missing-markdown", "missing-state", "missing-both"]).optional(),
  id: IdSchema,
  archived: z.boolean().default(false),
  title: z.string().max(150),
  titleGenerated: z.boolean().default(false),
  createdAt: z.string().datetime(),
  planConfirmed: z.boolean(),
  materials: z.array(MaterialSchema),
  learning: LearningStateSchema,
})
export const ProviderSessionSchema = z.object({
  provider: z.literal("codex"),
  threadId: z.string().min(1),
  home: z.string().min(1),
  executable: z.string().min(1),
  toolVersion: z.number().int().positive(),
  toolSignature: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.enum(["ready", "pending"]),
})
export const ChatSchema = TopicSchema.omit({ planConfirmed: true, archived: true, state: true, fileError: true }).extend({
  runnerId: IdSchema,
  scratchpadRequested: z.boolean().default(false),
  ownerScratchpadId: IdSchema.optional(),
  messages: z.array(MessageSchema),
  movedRequests: z.array(z.object({
    messageId: IdSchema,
    messageIndex: z.number().int().nonnegative(),
    chatId: IdSchema,
    scratchpadId: IdSchema.optional(),
  })).default([]),
  scratchpadHandles: z.array(IdSchema).default([]),
  providerSession: ProviderSessionSchema.optional(),
  activeTurnId: IdSchema.optional(),
  failedTurnId: IdSchema.optional(),
  turnError: z.string().optional(),
})
export const WorkspaceSchema = z.object({
  version: z.literal(2),
  // Preserve saved conversations when retiring the direct API provider.
  runners: z.array(z.union([
    z.object({ ...RunnerSchema.shape, provider: z.literal("openrouter").optional() }).transform((runner) => ({
      ...runner, provider: "codex" as const, model: providerDefaultModels.codex, reasoningEffort: undefined,
    })),
    RunnerSchema,
  ])),
  scratchpads: z.array(TopicSchema),
  chats: z.array(ChatSchema),
  providerSettings: z.array(z.union([
    ProviderSettingsSchema,
    ProviderSettingsSchema.extend({ id: z.literal("openrouter") }),
  ])).default([]).transform((settings) => settings.filter((item): item is z.infer<typeof ProviderSettingsSchema> => item.id !== "openrouter")),
})
// Version 1 stored one conversation per topic; it is migrated into independent chats on load.
export const LegacyWorkspaceSchema = WorkspaceSchema.omit({ chats: true }).extend({
  version: z.literal(1),
  scratchpads: z.array(
    TopicSchema.extend({ runnerId: IdSchema, messages: z.array(MessageSchema) }),
  ),
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
  chatId: IdSchema.optional(),
  turnId: IdSchema.optional(),
  activity: z.string(),
  reply: z.string().max(200_000).optional(),
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
export const PublicChatSchema = ChatSchema.omit({
  scratchpadHandles: true,
  providerSession: true,
  learning: true,
  materials: true,
}).extend({
  phase: LearningStateSchema.shape.phase,
  materials: z.array(MaterialSchema.omit({ text: true, pages: true })),
})
export const SnapshotSchema = z.object({
  runners: z.array(RunnerSchema),
  scratchpads: z.array(PublicTopicSchema),
  chats: z.array(PublicChatSchema),
  runtime: z.array(RuntimeSchema),
  connected: z.boolean(),
  providers: z.array(ProviderStatusSchema),
})
export const RuntimeUpdateSchema = SnapshotSchema.pick({ runtime: true })
export const CreateTopicSchema = z.object({
  title: z.string().trim().min(1).max(30_000),
  runnerId: IdSchema.optional(),
})
export const CreateChatSchema = z.object({ runnerId: IdSchema, ownerScratchpadId: IdSchema.optional(), scratchpadRequested: z.boolean().optional() })
export const ReconcileScratchpadSchema = z.object({
  scratchpadId: IdSchema,
  action: z.enum(["regenerate", "convert-to-generic"]),
})
export const ArchiveTopicSchema = z.object({ scratchpadId: IdSchema, archived: z.boolean() })
export const SendSchema = z.object({
  chatId: IdSchema,
  messageId: IdSchema.optional(),
  materialIds: z.array(IdSchema).optional(),
  content: z.string().max(30_000),
  confirmScratchpadId: IdSchema.optional(),
  openedScratchpadId: IdSchema.optional(),
}).refine((input) => input.content.trim().length > 0 || (input.materialIds?.length ?? 0) > 0, "Message cannot be empty.")
export const MaterialOwnerSchema = z.object({
  kind: z.enum(["topic", "chat"]),
  id: IdSchema,
})
export const RetrySchema = z.object({ chatId: IdSchema, turnId: IdSchema }).strict()
export const MaterialDraftSchema = MaterialSchema.pick({ id: true, name: true })
export const MaterialDraftIdsSchema = z.array(IdSchema).max(12)
export const DroppedMaterialsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(12),
  draftIds: MaterialDraftIdsSchema.default([]),
})
export const PastedImageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z.instanceof(Uint8Array).refine(
    (data) => data.byteLength > 0 && data.byteLength <= 8 * 1024 * 1024,
    "Use images smaller than 8 MB.",
  ),
})
export const PastedMaterialsSchema = z.object({
  images: z.array(PastedImageSchema).min(1).max(12),
  draftIds: MaterialDraftIdsSchema.default([]),
})
export const ImportMaterialsSchema = z.object({
  owner: MaterialOwnerSchema,
  draftIds: MaterialDraftIdsSchema.default([]),
})
export const TopicUpdateSchema = z.object({
  scratchpadId: IdSchema,
  learning: LearningStateSchema,
  expected: LearningStateSchema.optional(),
})
export const WorkerJobSchema = z.object({
  workflow: z.object({ turnId: IdSchema, attemptId: IdSchema, resume: z.boolean(), checkpointPath: z.string() }).optional(),
  telemetry: z.object({
    directory: z.string().min(1),
    parent: z.object({
      traceId: z.string().regex(/^[a-f0-9]{32}$/),
      spanId: z.string().regex(/^[a-f0-9]{16}$/),
      traceFlags: z.number().int().min(0).max(255),
    }),
  }).optional(),
  chat: ChatSchema,
  scratchpads: z.array(TopicSchema.extend({ assetDirectory: z.string() })),
  workspaceScratchpads: z.array(TopicSchema.pick({ id: true, title: true, archived: true }).extend({
    notes: LearningStateSchema.shape.notes,
    materials: z.array(MaterialSchema).optional(),
    assetDirectory: z.string().optional(),
    state: ScratchpadStateSchema.optional(),
  })).default([]),
  runner: RunnerSchema,
  apiKey: z.string().default(""),
  codex: CodexConnectionSchema.optional(),
  cli: CliConnectionSchema.optional(),
  skillDirectory: z.string(),
  assetDirectory: z.string(),
  sourceCacheDirectory: z.string().optional(),
  confirmScratchpadId: IdSchema.optional(),
  openedScratchpadId: IdSchema.optional(),
})
export const WorkerResultSchema = z.object({
  reply: z.string().min(1).max(200_000),
  learning: LearningStateSchema,
  scratchpadUpdates: z.array(TopicUpdateSchema).default([]),
  scratchpadMutations: z.array(ScratchpadMutationSchema).default([]),
  providerSession: ProviderSessionSchema.optional(),
})

export const WorkerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workflow_request"), requestId: IdSchema, attemptId: IdSchema, request: z.json() }),
  z.object({ type: z.literal("workflow_complete"), turnId: IdSchema }),
  z.object({ type: z.literal("reply"), text: z.string().max(200_000) }),
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
    invocationId: z.string().optional(),
  }),
  WorkerResultSchema.extend({ type: z.literal("result") }),
  z.object({ type: z.literal("error"), error: z.string() }),
])
export const Channel = {
  copyText: "edu:copy-text",
  reuseMaterials: "edu:reuse-materials",
  snapshot: "edu:snapshot",
  update: "edu:update",
  runtimeUpdate: "edu:runtime-update",
  connect: "edu:connect",
  disconnect: "edu:disconnect",
  cancelConnection: "edu:cancel-connection",
  refreshProviders: "edu:refresh-providers",
  saveProvider: "edu:save-provider",
  updateRunner: "edu:update-runner",
  addRunner: "edu:add-runner",
  removeRunner: "edu:remove-runner",
  startRunner: "edu:start-runner",
  stopRunner: "edu:stop-runner",
  createScratchpad: "edu:create-topic",
  createChat: "edu:create-chat",
  deleteStagedChat: "edu:delete-staged-chat",
  archiveScratchpad: "edu:archive-topic",
  reconcileScratchpad: "edu:reconcile-scratchpad",
  send: "edu:send",
  retry: "edu:retry",
  importMaterials: "edu:import-materials",
  removeChatMaterial: "edu:remove-chat-material",
  selectMaterials: "edu:select-materials",
  dropMaterials: "edu:drop-materials",
  pasteMaterials: "edu:paste-materials",
  discardMaterials: "edu:discard-materials",
  exportNotes: "edu:export-notes",
  openDiagnostics: "edu:open-diagnostics",
  openWorkspace: "edu:open-workspace",
  openMaterial: "edu:open-material",
} as const

export type Snapshot = z.infer<typeof SnapshotSchema>
export type Workspace = z.infer<typeof WorkspaceSchema>
export type Topic = z.infer<typeof TopicSchema>
export type Chat = z.infer<typeof ChatSchema>
export type LearningState = z.infer<typeof LearningStateSchema>
export type WorkerJob = z.infer<typeof WorkerJobSchema>
export type DesktopBridge = {
  copyText: (text: string, materialIds?: string[]) => Promise<void>
  reuseMaterials: (materialIds: string[], draftIds?: string[]) => Promise<z.infer<typeof MaterialDraftSchema>[]>
  snapshot: () => Promise<Snapshot>
  subscribe: (listener: (snapshot: Snapshot) => void) => () => void
  subscribeRuntime: (listener: (update: z.infer<typeof RuntimeUpdateSchema>) => void) => () => void
  connect: (provider?: z.infer<typeof ProviderIdSchema>) => Promise<void>
  disconnect: (provider?: z.infer<typeof ProviderIdSchema>) => Promise<void>
  cancelConnection: (
    provider: z.infer<typeof ProviderIdSchema>,
  ) => Promise<void>
  refreshProviders: (provider?: z.infer<typeof ProviderIdSchema>) => Promise<void>
  saveProvider: (input: z.input<typeof ProviderSettingsSchema>) => Promise<void>
  updateRunner: (
    id: string,
    input: z.input<typeof RunnerInputSchema>,
  ) => Promise<void>
  addRunner: (input: z.input<typeof RunnerInputSchema>) => Promise<string>
  removeRunner: (id: string) => Promise<void>
  startRunner: (id: string) => Promise<void>
  stopRunner: (id: string, chatId?: string) => Promise<void>
  createScratchpad: (input: z.input<typeof CreateTopicSchema>) => Promise<string>
  createChat: (input: z.infer<typeof CreateChatSchema>) => Promise<string>
  deleteStagedChat: (chatId: string) => Promise<void>
  archiveScratchpad: (input: z.infer<typeof ArchiveTopicSchema>) => Promise<void>
  reconcileScratchpad: (input: z.infer<typeof ReconcileScratchpadSchema>) => Promise<void>
  send: (input: z.infer<typeof SendSchema>) => Promise<void>
  retry: (input: z.infer<typeof RetrySchema>) => Promise<void>
  selectMaterials: (draftIds: z.infer<typeof MaterialDraftIdsSchema>) => Promise<z.infer<typeof MaterialDraftSchema>[]>
  dropMaterials: (files: File[], draftIds?: z.infer<typeof MaterialDraftIdsSchema>) => Promise<z.infer<typeof MaterialDraftSchema>[]>
  pasteMaterials: (images: z.infer<typeof PastedImageSchema>[], draftIds?: z.infer<typeof MaterialDraftIdsSchema>) => Promise<z.infer<typeof MaterialDraftSchema>[]>
  discardMaterials: (draftIds: z.infer<typeof MaterialDraftIdsSchema>) => Promise<void>
  removeChatMaterial: (chatId: string, materialId: string) => Promise<void>
  importMaterials: (owner: z.infer<typeof MaterialOwnerSchema>, draftIds?: z.infer<typeof MaterialDraftIdsSchema>) => Promise<void>
  exportNotes: (scratchpadId: string) => Promise<void>
  openDiagnostics: (chatId: string) => Promise<void>
  openWorkspace: (scratchpadId: string) => Promise<void>
  openMaterial: (materialId: string) => Promise<void>
}
