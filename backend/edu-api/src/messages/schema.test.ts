import { describe, expect, it } from "vitest";

import {
	ChatRequestSchema,
	MessagePartSchema,
	TopicMessageSchema,
	WsChatClientMessageSchema,
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

describe("WsServerMessageSchema", () => {
	it("accepts response messages", () => {
		expect(
			WsServerMessageSchema.parse({
				type: "response",
				messages: [
					{
						id: "msg_1",
						role: "agent",
						parts: [{ type: "text", content: "Hello" }],
						createdAt: "2026-08-23T00:00:00.000Z",
					},
				],
				runId: "run_1",
				topicId: "topic_1",
			}),
		).toMatchObject({
			type: "response",
			runId: "run_1",
			topicId: "topic_1",
		});
	});
});
