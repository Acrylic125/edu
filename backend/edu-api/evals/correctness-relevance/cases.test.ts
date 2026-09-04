import { describe, expect, it } from "vitest";

import { correctnessRelevanceCases } from "./cases";

describe("correctness and relevance evaluation dataset", () => {
	it("contains unique case ids", () => {
		const ids = correctnessRelevanceCases.map((testCase) => testCase.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("covers the main semantic evaluation categories", () => {
		const categories = new Set(
			correctnessRelevanceCases.map((testCase) => testCase.category),
		);
		expect(categories).toEqual(
			new Set([
				"concept-explanation",
				"calculation",
				"misconception-correction",
				"contextual-follow-up",
			]),
		);
	});
});
