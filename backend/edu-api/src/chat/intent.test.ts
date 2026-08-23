import { describe, expect, it } from "vitest";

import {
	deduceObviousIntent,
	looksLikeNextWithinTopic,
	lastPracticeQuestion,
	looksLikeStudentWork,
	parseExplicitCommand,
} from "./intent";
import type { AgentContext } from "./context";
import type { PersistedTopicMessage } from "../messages/schema";

function contextWith(
	messages: PersistedTopicMessage[],
): AgentContext {
	return {
		userId: "user_1",
		topic: {
			id: "topic_1",
			title: "Vectors",
			summary: "Vector arithmetic",
			part: "Vector subtraction",
		},
		recentMessages: messages,
		currentMessage: "",
	};
}

function agentMessage(
	id: string,
	text: string,
	extra: PersistedTopicMessage["parts"] = [],
): PersistedTopicMessage {
	return {
		id,
		topicId: "topic_1",
		role: "agent",
		parts: [{ type: "text", content: text }, ...extra],
		createdAt: new Date("2026-08-23T00:00:00.000Z"),
	};
}

describe("parseExplicitCommand", () => {
	it("parses /new command", () => {
		expect(parseExplicitCommand("/new Binary Search")).toEqual({
			type: "new-topic",
			message: "Binary Search",
		});
	});

	it("parses bare /new", () => {
		expect(parseExplicitCommand("/new")).toEqual({
			type: "new-topic",
			message: "",
		});
	});

	it("parses /update command", () => {
		expect(parseExplicitCommand("/update focus on complexity")).toEqual({
			type: "update-topic",
			message: "focus on complexity",
		});
	});

	it("parses /ans command", () => {
		expect(parseExplicitCommand("/ans x = 5")).toEqual({
			type: "answer",
			message: "x = 5",
		});
	});

	it("parses /new-qns command", () => {
		expect(parseExplicitCommand("/new-qns harder")).toEqual({
			type: "new-question",
			message: "harder",
		});
	});

	it("maps /topic to chat", () => {
		expect(parseExplicitCommand("/topic explain Prim's")).toEqual({
			type: "chat",
			message: "explain Prim's",
		});
	});

	it("returns null for natural language", () => {
		expect(parseExplicitCommand("Why is this O(n log n)?")).toBeNull();
	});
});

describe("deduceObviousIntent", () => {
	it("treats New qns as a new question", () => {
		expect(deduceObviousIntent("New qns", contextWith([]))).toEqual({
			type: "new-question",
			message: "New qns",
		});
	});

	it("treats a numeric matrix after a practice question as an answer", () => {
		const messages = [
			agentMessage(
				"q1",
				"Practice Question\nCompute 2u - 3v.",
			),
		];
		expect(
			deduceObviousIntent("4 5\n1 2", contextWith(messages)),
		).toEqual({
			type: "answer",
			message: "4 5\n1 2",
		});
	});

	it("does not treat a vague sentence as an answer", () => {
		const messages = [
			agentMessage("q1", "Practice Question\nCompute 2u - 3v."),
		];
		expect(
			deduceObviousIntent(
				"I am not sure how to start this",
				contextWith(messages),
			),
		).toBeNull();
	});
});

describe("looksLikeStudentWork", () => {
	it("accepts a 2x2 numeric grid", () => {
		expect(looksLikeStudentWork("4 5\n1 2")).toBe(true);
	});
});

describe("lastPracticeQuestion", () => {
	it("skips proposal prompts and returns the last practice question", () => {
		const messages = [
			agentMessage("q1", "Practice Question\nLet u = [1, 2]. Compute 2u."),
			agentMessage("p1", "Generate a new practice question?", [
				{
					type: "proposal",
					proposalId: "prop_1",
					prompt: "Generate a new practice question?",
					proposal: { kind: "new-question", message: "New qns" },
				},
			]),
		];
		expect(lastPracticeQuestion(messages)).toContain("Compute 2u");
	});
});


describe("looksLikeNextWithinTopic", () => {
	it("matches next-topic phrasing", () => {
		expect(looksLikeNextWithinTopic("whats the next topic?")).toBe(true);
		expect(looksLikeNextWithinTopic("What is the next section")).toBe(true);
		expect(looksLikeNextWithinTopic("explain eigenvectors")).toBe(false);
	});
});

describe("deduceObviousIntent next within topic", () => {
	it("does not treat next topic as an auto-apply command", () => {
		expect(deduceObviousIntent("whats the next topic?", contextWith([]))).toBeNull();
	});

	it("does not force update-topic when there is no active topic", () => {
		const empty = {
			...contextWith([]),
			topic: null,
		};
		expect(deduceObviousIntent("whats the next topic?", empty)).toBeNull();
	});
});
