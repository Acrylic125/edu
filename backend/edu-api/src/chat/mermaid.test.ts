import { describe, expect, it } from "vitest";

import { extractMermaidBlocks, findInvalidMermaid } from "./mermaid";

describe("Mermaid response validation", () => {
	it("extracts and validates complete Mermaid blocks", () => {
		const markdown = "Diagram:\n```mermaid\nflowchart LR\nA --> B\n```";

		expect(extractMermaidBlocks(markdown)).toEqual(["flowchart LR\nA --> B\n"]);
		expect(findInvalidMermaid(markdown)).toEqual([]);
	});

	it("reports missing directives and unclosed Mermaid blocks", () => {
		expect(findInvalidMermaid("```mermaid\nflowchart LR\nA -->")).toContain(
			"unclosed Mermaid code block",
		);
		expect(
			findInvalidMermaid("```mermaid\nnot-a-diagram\n```"),
		).not.toEqual([]);
	});
});
