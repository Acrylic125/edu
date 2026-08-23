import { z } from "zod";

export const TextPartSchema = z.object({
	type: z.literal("text"),
	content: z.string(),
});

export const AttachmentPartSchema = z.object({
	type: z.literal("attachment"),
	ref: z.string(),
});

export const OptionItemSchema = z.object({
	label: z.string(),
});

export const OptionsPartSchema = z.object({
	type: z.literal("options"),
	options: z.array(OptionItemSchema),
});

export const MessagePartSchema = z.discriminatedUnion("type", [
	TextPartSchema,
	AttachmentPartSchema,
	OptionsPartSchema,
]);

export const MessagePartsSchema = z.array(MessagePartSchema);

export const MessageRoleSchema = z.enum(["user", "agent"]);

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
	message: z.string().min(1),
	parts: MessagePartsSchema.min(1),
});

export const ChatResponseSchema = z.object({
	messages: z.array(ResponseMessageSchema),
	runId: z.string(),
	topicId: z.string().optional(),
});

export const WsChatClientMessageSchema = ChatRequestSchema.extend({
	type: z.literal("message"),
});

export const WsReadyMessageSchema = z.object({
	type: z.literal("ready"),
	userId: z.string(),
});

export const WsBusyMessageSchema = z.object({
	type: z.literal("busy"),
	message: z.string(),
});

export const WsErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});

export const WsChatResponseMessageSchema = ChatResponseSchema.extend({
	type: z.literal("response"),
});

export const WsServerMessageSchema = z.discriminatedUnion("type", [
	WsReadyMessageSchema,
	WsBusyMessageSchema,
	WsErrorMessageSchema,
	WsChatResponseMessageSchema,
]);

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type TopicMessage = z.infer<typeof TopicMessageSchema>;
export type PersistedTopicMessage = z.infer<typeof PersistedTopicMessageSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type WsChatClientMessage = z.infer<typeof WsChatClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type CreateTopicMessageInput = z.input<typeof CreateTopicMessageSchema>;
