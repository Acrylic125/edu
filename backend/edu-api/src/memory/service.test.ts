import { describe, expect, it } from "vitest";

import { rankConversationMemories } from "./service";
import type { RetrievedMemory } from "./schema";

function memory(
	id: string,
	params: { topicId?: string; summary: string; keywords?: string[] },
): RetrievedMemory {
	return {
		id,
		topicId: params.topicId ?? null,
		intent: "chat",
		summary: params.summary,
		keywords: params.keywords ?? [],
		createdAt: new Date("2026-09-05T00:00:00Z"),
		hasImages: false,
	};
}

describe("rankConversationMemories", () => {
	it("prioritizes semantic terms and preserves current-topic continuity", () => {
		const memories = [
			memory("unrelated", {
				topicId: "topic_other",
				summary: "The learner reviewed organic chemistry.",
			}),
			memory("same_topic", {
				topicId: "topic_1",
				summary: "The learner practiced matrix multiplication.",
			}),
			memory("matching", {
				topicId: "topic_other",
				summary: "Eigenvalues were derived from the characteristic polynomial.",
				keywords: ["eigenvector"],
			}),
		];

		const ranked = rankConversationMemories(
			memories,
			"How do eigenvalues relate to an eigenvector?",
			"topic_1",
		);

		expect(ranked.map((item) => item.id)).toEqual([
			"matching",
			"same_topic",
		]);
	});

	it("does not return unrelated memories from other topics", () => {
		const ranked = rankConversationMemories(
			[
				memory("chemistry", {
					topicId: "topic_2",
					summary: "Balancing oxidation reactions.",
				}),
			],
			"Explain a deterministic finite automaton",
			"topic_1",
		);

		expect(ranked).toEqual([]);
	});
});
