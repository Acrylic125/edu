import { describe, expect, it } from "vitest";

import { formatTopicPlanMarkdown } from "./new-topic";

describe("formatTopicPlanMarkdown", () => {
	it("renders a markdown table under Here's the plan", () => {
		const markdown = formatTopicPlanMarkdown([
			{
				chapter: "Basics",
				whatIsCovered: "Rates of change",
			},
			{
				chapter: "Product rule",
				whatIsCovered: "Differentiate products",
			},
		]);

		expect(markdown).toBe(
			[
				"Here's the plan",
				"",
				"| Chapter | What is covered |",
				"| --- | --- |",
				"| Basics | Rates of change |",
				"| Product rule | Differentiate products |",
			].join("\n"),
		);
	});

	it("escapes pipes in cell text", () => {
		const markdown = formatTopicPlanMarkdown([
			{
				chapter: "A|B",
				whatIsCovered: "one|two",
			},
		]);

		expect(markdown).toContain("| A\\|B | one\\|two |");
	});
});
