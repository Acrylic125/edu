import { describe, expect, it, vi } from "vitest";

import type { AgentRunner } from "../agents/runner";
import { extractLatexBlocks, findInvalidLatex, repairInvalidLatex } from "./latex";

describe("LaTeX response validation", () => {
	it("extracts inline, display, and fenced LaTeX", () => {
		const blocks = extractLatexBlocks([
			"Use $x^2$ here.",
			"$$\\frac{1}{2}$$",
			"```latex",
			"\\begin{matrix}1 & 2\\\\3 & 4\\end{matrix}",
			"```",
		].join("\n"));

		expect(blocks.map((block) => block.latex)).toEqual([
			"\\begin{matrix}1 & 2\\\\3 & 4\\end{matrix}\n",
			"\\frac{1}{2}",
			"x^2",
		]);
	});

	it("reports expressions rejected by KaTeX", () => {
		expect(findInvalidLatex("Broken: $\\frac{1}{$")).not.toEqual([]);
		expect(findInvalidLatex("Valid: $\\frac{1}{2}$")).toEqual([]);
	});

	it("repairs invalid text parts with one LLM call", async () => {
		const runner = {
			announce: vi.fn(),
			llmCall: vi.fn().mockResolvedValue("Fixed: $\\frac{1}{2}$"),
		} as Pick<AgentRunner, "announce" | "llmCall"> as AgentRunner;

		const parts = await repairInvalidLatex(runner, [
			{ type: "text", content: "Broken: $\\frac{1}{$" },
			{ type: "options", options: [{ label: "Continue" }] },
		]);

		expect(runner.llmCall).toHaveBeenCalledOnce();
		expect(parts).toEqual([
			{ type: "text", content: "Fixed: $\\frac{1}{2}$" },
			{ type: "options", options: [{ label: "Continue" }] },
		]);
	});
});
