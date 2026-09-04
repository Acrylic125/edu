import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../db/client";
import type { AgentContext } from "./context";

const mocks = vi.hoisted(() => ({
	createAgentRun: vi.fn(),
	loadChatContext: vi.fn(),
	maybeScheduleSummaryUpdate: vi.fn(),
}));

vi.mock("../agents/runner", () => ({
	createAgentRun: mocks.createAgentRun,
}));

vi.mock("./context", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./context")>();
	return {
		...actual,
		loadChatContext: mocks.loadChatContext,
		maybeScheduleSummaryUpdate: mocks.maybeScheduleSummaryUpdate,
	};
});

import { handleChat } from "./route";

describe("handleChat end-to-end orchestration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes an in-topic explanation and streams the final response", async () => {
		const deltas: string[] = [];
		const progress: string[] = [];
		const context: AgentContext = {
			userId: "user_1",
			topic: {
				id: "topic_1",
				title: "Finite automata",
				summary: "DFAs, NFAs, and regular languages",
				part: "Deterministic finite automata",
			},
			recentMessages: [],
			currentMessage: "Why can a DFA only follow one path?",
		};
		mocks.loadChatContext.mockResolvedValue(context);

		const llmCall = vi.fn().mockResolvedValue("chat");
		const llmStream = vi.fn(async (params: { onChunk: (text: string) => void }) => {
			params.onChunk("A DFA has exactly one transition ");
			params.onChunk("for each state and input symbol.");
			return "A DFA has exactly one transition for each state and input symbol.";
		});
		const runner = {
			announce: vi.fn((label: string) => progress.push(label)),
			complete: vi.fn(),
			fail: vi.fn(),
			llmCall,
			llmStream,
			recordRoutingStep: vi.fn(),
			withTrace: vi.fn((fn: () => Promise<object>) => fn()),
		};
		mocks.createAgentRun.mockResolvedValue(runner);

		const result = await handleChat(
			{} as Db,
			{ OPENROUTER_API_KEY: "test-key" },
			"user_1",
			{
				message: "msg_user_1",
				parts: [
					{
						type: "text",
						content: "Why can a DFA only follow one path?",
					},
				],
			},
			{
				signal: new AbortController().signal,
				runId: "run_1",
				assistantMessageId: "msg_agent_1",
				userMessageId: "msg_user_1",
				onDelta: (_partIndex, text) => deltas.push(text),
				onProgress: (label) => progress.push(label),
			},
		);

		expect(llmCall).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "infer_intent",
				input: "Why can a DFA only follow one path?",
			}),
		);
		expect(llmStream).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "generate_response",
				input: "Why can a DFA only follow one path?",
			}),
		);
		expect(deltas.join("")).toBe(
			"A DFA has exactly one transition for each state and input symbol.",
		);
		expect(result).toEqual({
			parts: [
				{
					type: "text",
					content:
						"A DFA has exactly one transition for each state and input symbol.",
				},
			],
			topicId: "topic_1",
			pendingProposal: null,
		});
		expect(runner.recordRoutingStep).toHaveBeenCalledWith(
			"route",
			{ message: "Why can a DFA only follow one path?" },
			{ type: "reply" },
		);
		expect(runner.complete).toHaveBeenCalledOnce();
		expect(runner.fail).not.toHaveBeenCalled();
		expect(progress).toEqual(["Reading your message", "Writing a response"]);
	});
});
