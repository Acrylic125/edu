import { describe, expect, it } from "vitest";

import {
	ChatRequestSchema,
	MessagePartSchema,
	TopicMessageSchema,
	WsChatClientMessageSchema,
	WsClientEnvelopeSchema,
	WsServerMessageSchema,
} from "./schema";

describe("MessagePartSchema", () => {
	it("accepts text parts", () => {
		expect(
			MessagePartSchema.parse({ type: "text", content: "hello" }),
		).toEqual({ type: "text", content: "hello" });
	});

	it("accepts attachment parts", () => {
		expect(
			MessagePartSchema.parse({
				type: "attachment",
				ref: "r2://bucket/key",
			}),
		).toEqual({ type: "attachment", ref: "r2://bucket/key" });
	});

	it("accepts options parts", () => {
		expect(
			MessagePartSchema.parse({
				type: "options",
				options: [{ label: "Explain" }],
			}),
		).toEqual({
			type: "options",
			options: [{ label: "Explain" }],
		});
	});

	it("accepts proposal parts", () => {
		expect(
			MessagePartSchema.parse({
				type: "proposal",
				proposalId: "prop_1",
				prompt: "Create this topic?",
				proposal: {
					kind: "create-topic",
					title: "Binary Search",
					summary: "Learn binary search.",
					part: "understanding the basics",
				},
			}),
		).toMatchObject({
			type: "proposal",
			proposalId: "prop_1",
			proposal: { kind: "create-topic" },
		});
	});
});

describe("ChatRequestSchema", () => {
	it("requires message id and parts", () => {
		expect(
			ChatRequestSchema.parse({
				message: "msg_123",
				parts: [{ type: "text", content: "Binary Search" }],
			}),
		).toEqual({
			message: "msg_123",
			parts: [{ type: "text", content: "Binary Search" }],
		});
	});
});

describe("TopicMessageSchema", () => {
	it("accepts multi-part messages", () => {
		expect(
			TopicMessageSchema.parse({
				id: "msg_1",
				role: "agent",
				parts: [
					{ type: "text", content: "Welcome" },
					{
						type: "options",
						options: [{ label: "Test me" }],
					},
				],
				createdAt: "2026-08-23T00:00:00.000Z",
			}),
		).toMatchObject({
			id: "msg_1",
			role: "agent",
			parts: [
				{ type: "text", content: "Welcome" },
				{
					type: "options",
					options: [{ label: "Test me" }],
				},
			],
		});
	});
});

describe("WsChatClientMessageSchema", () => {
	it("wraps chat requests", () => {
		expect(
			WsChatClientMessageSchema.parse({
				type: "message",
				message: "msg_123",
				parts: [{ type: "text", content: "Binary Search" }],
			}),
		).toEqual({
			type: "message",
			message: "msg_123",
			parts: [{ type: "text", content: "Binary Search" }],
		});
	});
});

describe("WsClientEnvelopeSchema", () => {
	it("accepts stop frames", () => {
		expect(
			WsClientEnvelopeSchema.parse({ type: "stop", runId: "run_1" }),
		).toEqual({ type: "stop", runId: "run_1" });
	});

	it("accepts decision frames", () => {
		expect(
			WsClientEnvelopeSchema.parse({
				type: "decision",
				proposalId: "prop_1",
				decision: "accept",
			}),
		).toEqual({
			type: "decision",
			proposalId: "prop_1",
			decision: "accept",
		});
	});
});

describe("WsServerMessageSchema", () => {
	it("accepts ready messages", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "ready",
				userId: "user_1",
				pendingProposalId: null,
			}),
		).toMatchObject({
			type: "ready",
			userId: "user_1",
		});
	});

	it("accepts run.started", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "run.started",
				runId: "run_1",
				messageId: "msg_a",
				topicId: "topic_1",
			}),
		).toMatchObject({
			type: "run.started",
			runId: "run_1",
			messageId: "msg_a",
		});
	});

	it("accepts run.delta", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "run.delta",
				runId: "run_1",
				messageId: "msg_a",
				partIndex: 0,
				text: "Hello ",
			}),
		).toMatchObject({
			type: "run.delta",
			text: "Hello ",
		});
	});

	it("accepts run.progress", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "run.progress",
				runId: "run_1",
				messageId: "msg_a",
				label: "Checking your answer",
			}),
		).toMatchObject({
			type: "run.progress",
			label: "Checking your answer",
		});
	});

	it("accepts run.ended", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "run.ended",
				runId: "run_1",
				messageId: "msg_a",
				parts: [{ type: "text", content: "Hello" }],
				topicId: "topic_1",
				status: "completed",
			}),
		).toMatchObject({
			type: "run.ended",
			status: "completed",
		});
	});

	it("rejects busy and response frames", () => {
		expect(
			WsServerMessageSchema.safeParse({
				type: "busy",
				message: "Agent is already running.",
			}).success,
		).toBe(false);
		expect(
			WsServerMessageSchema.safeParse({
				type: "response",
				messages: [],
				runId: "run_1",
			}).success,
		).toBe(false);
	});
});
