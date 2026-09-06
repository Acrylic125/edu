import { describe, expect, it, vi } from "vitest";

import type { AgentRunner } from "../agents/runner";
import {
	extractLatexBlocks,
	findInvalidLatex,
	normalizeResponseMath,
	repairInvalidResponseMarkup,
} from "./latex";

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
			"x^2",
			"\\frac{1}{2}",
		]);
	});

	it("reports expressions rejected by KaTeX", () => {
		expect(findInvalidLatex("Broken: $\\frac{1}{$")).not.toEqual([]);
		expect(findInvalidLatex("Valid: $\\frac{1}{2}$")).toEqual([]);
	});

	it("reports unclosed math delimiters", () => {
		expect(findInvalidLatex("Truncated: $2 \\pmod")).toContain(
			"unclosed inline math delimiter",
		);
		expect(findInvalidLatex("Truncated: $$x + y")).toContain(
			"unclosed display math delimiter",
		);
	});

	it("normalizes malformed trailing display delimiters", () => {
		const malformed = "\\quad\\Longrightarrow\\quad F'(x)=2x\\cos(x^6).$$";
		const normalized = "$$\\quad\\Longrightarrow\\quad F'(x)=2x\\cos(x^6).$$";
		expect(normalizeResponseMath(malformed)).toBe(normalized);
		expect(findInvalidLatex(normalized)).toEqual([]);
	});

	it("ignores dollar signs inside non-LaTeX code fences", () => {
		expect(findInvalidLatex("```sh\necho $HOME\n```")).toEqual([]);
	});

	it("does not normalize math-like text inside code fences", () => {
		const markdown = [
			"Before \\(x^2\\)",
			"```text",
			"\\[not rendered\\]",
			"\\quad example$$",
			"```",
		].join("\n");

		expect(normalizeResponseMath(markdown)).toBe([
			"Before $x^2$",
			"```text",
			"\\[not rendered\\]",
			"\\quad example$$",
			"```",
		].join("\n"));
	});

	it("repairs invalid text parts with one LLM call", async () => {
		const runner = {
			announce: vi.fn(),
			llmCall: vi.fn().mockResolvedValue("Fixed: $\\frac{1}{2}$"),
		} as Pick<AgentRunner, "announce" | "llmCall"> as AgentRunner;

		const parts = await repairInvalidResponseMarkup(runner, [
			{ type: "text", content: "Broken: $\\frac{1}{$" },
			{ type: "options", options: [{ label: "Continue" }] },
		]);

		expect(runner.llmCall).toHaveBeenCalledOnce();
		expect(parts).toEqual([
			{ type: "text", content: "Fixed: $\\frac{1}{2}$" },
			{ type: "options", options: [{ label: "Continue" }] },
		]);
	});

	it("makes markup inert when the repair is still invalid", async () => {
		const runner = {
			announce: vi.fn(),
			llmCall: vi.fn().mockResolvedValue(
				"```mermaid\nnot-a-diagram\n```\nBroken: $x",
			),
		} as Pick<AgentRunner, "announce" | "llmCall"> as AgentRunner;

		const parts = await repairInvalidResponseMarkup(runner, [
			{ type: "text", content: "Broken: $x" },
		]);

		expect(parts).toEqual([
			{
				type: "text",
				content: "```text\nnot-a-diagram\n```\nBroken: \\$x",
			},
		]);
	});
});
