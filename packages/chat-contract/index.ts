import { z } from "zod";

export const TextPartSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
});

export const AttachmentPartSchema = z.object({
  type: z.literal("attachment"),
  ref: z.string(),
  url: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

export const OptionItemSchema = z.object({
  label: z.string(),
});

export const OptionsPartSchema = z.object({
  type: z.literal("options"),
  options: z.array(OptionItemSchema),
});

export const TopicPlanStepSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(120),
  summary: z.string().min(1).max(4000),
  parent: z.string().min(1).max(128).nullable(),
});

export const PlanPartSchema = z.object({
  type: z.literal("plan"),
  steps: z.array(TopicPlanStepSchema).min(1).max(32),
});

export const TopicPlanSchema = z.array(TopicPlanStepSchema).min(1).max(32).superRefine((steps, ctx) => {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (ids.has(step.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Step ids must be unique" });
    ids.add(step.id);
  }
  for (const [index, step] of steps.entries()) {
    if (step.parent === step.id || (step.parent !== null && !ids.has(step.parent))) {
      ctx.addIssue({ code: "custom", path: [index, "parent"], message: "Parent must reference another step" });
    }
  }
  const byId = new Map(steps.map((step) => [step.id, step]));
  for (const [index, step] of steps.entries()) {
    const seen = new Set<string>();
    let cursor = step.parent;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        ctx.addIssue({ code: "custom", path: [index, "parent"], message: "Plan hierarchy cannot contain cycles" });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent ?? null;
    }
  }
});

export type TopicPlanStep = z.infer<typeof TopicPlanStepSchema>;

const TopicPlanItemBaseSchema = z.object({
  sourceIndex: z.number().int().min(0).max(31).optional(),
  title: z.string().min(1).max(120),
});

export const TopicPlanItemSchema = z.discriminatedUnion("role", [
  TopicPlanItemBaseSchema.extend({ role: z.literal("context") }),
  TopicPlanItemBaseSchema.extend({ role: z.literal("header") }),
  TopicPlanItemBaseSchema.extend({
    role: z.literal("section"),
    depth: z.number().int().min(0).max(4),
  }),
]);

const SuppliedTopicPlanItemBaseSchema = TopicPlanItemBaseSchema.required({
  sourceIndex: true,
});

export const SuppliedTopicPlanItemSchema = z.discriminatedUnion("role", [
  SuppliedTopicPlanItemBaseSchema.extend({ role: z.literal("context") }),
  SuppliedTopicPlanItemBaseSchema.extend({ role: z.literal("header") }),
  SuppliedTopicPlanItemBaseSchema.extend({
    role: z.literal("section"),
    depth: z.number().int().min(0).max(4),
  }),
]);

export type TopicPlanItem = z.infer<typeof TopicPlanItemSchema>;

export const CreateTopicProposalSchema = z.object({
  kind: z.literal("create-topic"),
  plan: TopicPlanSchema.optional(),
  legacyPlan: z.array(TopicPlanItemSchema).optional(),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(4000),
  part: z.string().min(1).max(120),
});

export const UpdateTopicProposalSchema = z.object({
  kind: z.literal("update-topic"),
  title: z.string().optional(),
  summary: z.string().optional(),
  part: z.string().min(1).max(120).optional(),
  explanation: z.string().optional(),
});

export const ProposalSchema = z.discriminatedUnion("kind", [
  CreateTopicProposalSchema,
  UpdateTopicProposalSchema,
]);

export const ProposalPartSchema = z.object({
  type: z.literal("proposal"),
  proposalId: z.string(),
  prompt: z.string(),
  proposal: ProposalSchema,
});

export const MessagePartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  AttachmentPartSchema,
  OptionsPartSchema,
  PlanPartSchema,
  ProposalPartSchema,
]);

export const MessagePartsSchema = z.array(MessagePartSchema);

export const MessageRoleSchema = z.enum(["user", "assistant"]);

export const TopicMessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  parts: MessagePartsSchema,
  createdAt: z.coerce.date(),
});

export const PersistedTopicMessageSchema = TopicMessageSchema.extend({
  topicId: z.string(),
});

export const ResponseMessageSchema = TopicMessageSchema.extend({
  createdAt: z.string(),
});

export const CreateTopicMessageSchema = z.object({
  id: z.string().optional(),
  topicId: z.string(),
  role: MessageRoleSchema,
  parts: MessagePartsSchema.min(1),
});

export const ChatRequestSchema = z.object({
  messageId: z.string().min(1).max(128),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("text"),
            content: z.string().trim().min(1).max(16000),
          })
          .strict(),
        z
          .object({
            type: z.literal("attachment"),
            ref: z.string().min(1).max(128),
          })
          .strict(),
      ]),
    )
    .min(1)
    .max(6),
  // Client's active topic — DO syncs userCurrentTopic before the run.
  topicId: z.string().min(1).max(128).optional(),
});

export const ChatResponseSchema = z.object({
  messages: z.array(ResponseMessageSchema),
  runId: z.string(),
  topicId: z.string().min(1).max(128).optional(),
});

export const WsChatClientMessageSchema = ChatRequestSchema.extend({
  type: z.literal("message"),
});

export const WsChatClientStopSchema = z.object({
  type: z.literal("stop"),
  runId: z.string(),
});

export const WsChatClientDecisionSchema = z.object({
  type: z.literal("decision"),
  proposalId: z.string(),
  decision: z.enum(["accept", "reject"]),
});

export const WsClientEnvelopeSchema = z.discriminatedUnion("type", [
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  WsChatClientDecisionSchema,
]);

export const WsReadyMessageSchema = z.object({
  type: z.literal("ready"),
  userId: z.string(),
  pendingProposalId: z.string().nullable().optional(),
});

export const WsErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  runId: z.string().nullable().optional(),
});

export const WsRunStartedMessageSchema = z.object({
  type: z.literal("run.started"),
  runId: z.string(),
  messageId: z.string(),
  topicId: z.string().min(1).max(128).optional(),
});

export const WsRunDeltaMessageSchema = z.object({
  type: z.literal("run.delta"),
  runId: z.string(),
  messageId: z.string(),
  partIndex: z.number().int().min(0).max(31),
  text: z.string(),
});

export const WsRunProgressMessageSchema = z.object({
  type: z.literal("run.progress"),
  runId: z.string(),
  messageId: z.string(),
  label: z.string(),
});

export const WsRunEndedMessageSchema = z.object({
  type: z.literal("run.ended"),
  runId: z.string(),
  messageId: z.string(),
  parts: MessagePartsSchema,
  topicId: z.string().min(1).max(128).optional(),
  status: z.enum(["completed", "cancelled", "failed"]),
});

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WsReadyMessageSchema,
  WsErrorMessageSchema,
  WsRunStartedMessageSchema,
  WsRunDeltaMessageSchema,
  WsRunProgressMessageSchema,
  WsRunEndedMessageSchema,
]);

export const CurrentTopicMessagesSchema = z.object({
  topic: z
    .object({
      id: z.string(),
      title: z.string(),
      part: z.string().nullable().optional(),
      currentStepId: z.string().nullable().optional(),
    })
    .nullable(),
  messages: z.array(ResponseMessageSchema),
});

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type TopicMessage = z.infer<typeof TopicMessageSchema>;
export type PersistedTopicMessage = z.infer<typeof PersistedTopicMessageSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type WsChatClientMessage = z.infer<typeof WsChatClientMessageSchema>;
export type WsClientEnvelope = z.infer<typeof WsClientEnvelopeSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type CreateTopicMessageInput = z.input<typeof CreateTopicMessageSchema>;

export const TopicListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const TopicsListSchema = z.object({
  topics: z.array(TopicListingSchema),
});
export type CurrentTopicMessages = z.infer<typeof CurrentTopicMessagesSchema>;
export type TopicsList = z.infer<typeof TopicsListSchema>;
export type TopicListing = z.infer<typeof TopicListingSchema>;
export type UserMessagePart = ChatRequest["parts"][number];
export const MAX_WS_MESSAGE_BYTES = 65536;

export function partsToText(parts: MessagePart[]) {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      lines.push(part.content);
    }
    if (part.type === "attachment") {
      lines.push(`[attachment: ${part.ref}]`);
    }
    if (part.type === "options") {
      lines.push(part.options.map((option) => option.label).join(", "));
    }
    if (part.type === "plan") {
      lines.push(part.steps.map((step) => `${step.label}: ${step.summary}`).join("\n"));
    }
    if (part.type === "proposal") {
      lines.push(part.prompt);
    }
  }
  return lines.join("\n").trim();
}

export const CHAT_COMMANDS = [
  {
    name: "new",
    displayName: "New topic",
    description: "Create a learning plan.",
    intent: "new-topic",
  },
  {
    name: "update",
    displayName: "Update plan",
    description: "Change the current learning focus.",
    intent: "update-topic",
  },
  {
    name: "ans",
    displayName: "Check answer",
    description: "Assess your solution.",
    intent: "answer",
  },
  {
    name: "new-qns",
    displayName: "Practice",
    description: "Generate a practice question.",
    intent: "new-question",
  },
  {
    name: "topic",
    displayName: "Explain",
    description: "Discuss the current topic.",
    intent: "chat",
  },
] as const;
