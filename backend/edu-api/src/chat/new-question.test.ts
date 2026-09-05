import { describe, expect, it, vi } from "vitest";

import type { AgentRunner } from "../agents/runner";
import type { AgentContext } from "./context";
import { executeNewQuestion } from "./new-question";

describe("executeNewQuestion", () => {
	it("passes prior practice questions as a semantic exclusion index", async () => {
		let instructions = "";
		const runner = {
			announce: vi.fn(),
			llmStream: vi.fn(async (params: {
				instructions: string;
				onChunk: (text: string) => void;
			}) => {
				instructions = params.instructions;
				params.onChunk("A different question");
				return "A different question";
			}),
		};
		const context: AgentContext = {
			userId: "user_1",
			topic: {
				id: "topic_1",
				title: "Logic",
				summary: "Propositions and quantifiers",
				part: "Propositional logic",
			},
			recentMessages: [
				{
					id: "message_1",
					topicId: "topic_1",
					role: "agent",
					parts: [
						{
							type: "text",
							content:
								"### Practice Question: Logical Equivalence\\nDetermine whether p → q and ¬p ∨ q are equivalent.",
						},
					],
					createdAt: new Date(),
				},
			],
			currentMessage: "next question",
		};

		await executeNewQuestion(
			runner as Pick<AgentRunner, "announce" | "llmStream"> as AgentRunner,
			context,
			"next question",
			vi.fn(),
		);

		expect(instructions).toContain(
			"Recent practice-question exclusion history",
		);
		expect(instructions).toContain("Logical Equivalence");
		expect(instructions).toContain(
			"Do not repeat the same underlying task, theorem, identity",
		);
	});
});
