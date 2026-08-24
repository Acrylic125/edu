import { z } from "zod"

export const TextPartSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
})

export const AttachmentPartSchema = z.object({
  type: z.literal("attachment"),
  ref: z.string(),
  url: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
})

export const OptionItemSchema = z.object({
  label: z.string(),
})

export const OptionsPartSchema = z.object({
  type: z.literal("options"),
  options: z.array(OptionItemSchema),
})

export const CreateTopicProposalSchema = z.object({
  kind: z.literal("create-topic"),
  title: z.string(),
  summary: z.string(),
  part: z.string(),
})

export const UpdateTopicProposalSchema = z.object({
  kind: z.literal("update-topic"),
  title: z.string().optional(),
  summary: z.string().optional(),
  part: z.string().optional(),
  explanation: z.string().optional(),
})

export const GradeAnswerProposalSchema = z.object({
  kind: z.literal("grade-answer"),
  question: z.string(),
  solution: z.string(),
})

export const NewQuestionProposalSchema = z.object({
  kind: z.literal("new-question"),
  message: z.string(),
})

export const ProposalSchema = z.discriminatedUnion("kind", [
  CreateTopicProposalSchema,
  UpdateTopicProposalSchema,
  GradeAnswerProposalSchema,
  NewQuestionProposalSchema,
])

export const ProposalPartSchema = z.object({
  type: z.literal("proposal"),
  proposalId: z.string(),
  prompt: z.string(),
  proposal: ProposalSchema,
})

export const MessagePartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  AttachmentPartSchema,
  OptionsPartSchema,
  ProposalPartSchema,
])

export const MessagePartsSchema = z.array(MessagePartSchema)

export const MessageRoleSchema = z.enum(["user", "agent"])

export const TopicMessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  parts: MessagePartsSchema,
  createdAt: z.coerce.date(),
})

export const PersistedTopicMessageSchema = TopicMessageSchema.extend({
  topicId: z.string(),
})

export const ResponseMessageSchema = TopicMessageSchema.extend({
  createdAt: z.string(),
})

export const CreateTopicMessageSchema = z.object({
  id: z.string().optional(),
  topicId: z.string(),
  role: MessageRoleSchema,
  parts: MessagePartsSchema.min(1),
})

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  parts: MessagePartsSchema.min(1),
})

export const ChatResponseSchema = z.object({
  messages: z.array(ResponseMessageSchema),
  runId: z.string(),
  topicId: z.string().optional(),
})

export const WsChatClientMessageSchema = ChatRequestSchema.extend({
  type: z.literal("message"),
})

export const WsChatClientStopSchema = z.object({
  type: z.literal("stop"),
  runId: z.string(),
})

export const WsChatClientDecisionSchema = z.object({
  type: z.literal("decision"),
  proposalId: z.string(),
  decision: z.enum(["accept", "reject"]),
})

export const WsClientEnvelopeSchema = z.discriminatedUnion("type", [
  WsChatClientMessageSchema,
  WsChatClientStopSchema,
  WsChatClientDecisionSchema,
])

export const WsReadyMessageSchema = z.object({
  type: z.literal("ready"),
  userId: z.string(),
  pendingProposalId: z.string().nullable().optional(),
})

export const WsErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  runId: z.string().nullable().optional(),
})

export const WsRunStartedMessageSchema = z.object({
  type: z.literal("run.started"),
  runId: z.string(),
  messageId: z.string(),
  topicId: z.string().optional(),
})

export const WsRunDeltaMessageSchema = z.object({
  type: z.literal("run.delta"),
  runId: z.string(),
  messageId: z.string(),
  partIndex: z.number(),
  text: z.string(),
})

export const WsRunProgressMessageSchema = z.object({
  type: z.literal("run.progress"),
  runId: z.string(),
  messageId: z.string(),
  label: z.string(),
})

export const WsRunEndedMessageSchema = z.object({
  type: z.literal("run.ended"),
  runId: z.string(),
  messageId: z.string(),
  parts: MessagePartsSchema,
  topicId: z.string().optional(),
  status: z.enum(["completed", "cancelled", "failed"]),
})

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WsReadyMessageSchema,
  WsErrorMessageSchema,
  WsRunStartedMessageSchema,
  WsRunDeltaMessageSchema,
  WsRunProgressMessageSchema,
  WsRunEndedMessageSchema,
])

export const CurrentTopicMessagesSchema = z.object({
  topic: z
    .object({
      id: z.string(),
      title: z.string(),
    })
    .nullable(),
  messages: z.array(ResponseMessageSchema),
})

export const TopicListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const TopicsListSchema = z.object({
  topics: z.array(TopicListingSchema),
})

export type MessagePart = z.infer<typeof MessagePartSchema>
export type MessageRole = z.infer<typeof MessageRoleSchema>
export type TopicMessage = z.infer<typeof TopicMessageSchema>
export type PersistedTopicMessage = z.infer<typeof PersistedTopicMessageSchema>
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>
export type Proposal = z.infer<typeof ProposalSchema>
export type WsChatClientMessage = z.infer<typeof WsChatClientMessageSchema>
export type WsClientEnvelope = z.infer<typeof WsClientEnvelopeSchema>
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>
export type CreateTopicMessageInput = z.input<typeof CreateTopicMessageSchema>
export type CurrentTopicMessages = z.infer<typeof CurrentTopicMessagesSchema>
export type TopicsList = z.infer<typeof TopicsListSchema>

export function partsToText(parts: MessagePart[]) {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === "text") {
      lines.push(part.content)
    }
    if (part.type === "attachment") {
      lines.push(`[attachment: ${part.ref}]`)
    }
    if (part.type === "options") {
      lines.push(part.options.map((option) => option.label).join(", "))
    }
    if (part.type === "proposal") {
      lines.push(part.prompt)
    }
  }
  return lines.join("\n").trim()
}
