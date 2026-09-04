import katex from "katex";

import type { AgentRunner } from "../agents/runner";
import type { MessagePart } from "../messages/schema";

type LatexBlock = {
	latex: string;
	label: string;
};

const FENCED_LATEX_RE = /```(?:latex|tex)\s*\n([\s\S]*?)```/gi;
const DISPLAY_LATEX_RE = /\$\$([\s\S]*?)\$\$/g;
const INLINE_LATEX_RE = /(^|[^\\$])\$([^\n$]+?)\$/g;

export function extractLatexBlocks(markdown: string) {
	const blocks: LatexBlock[] = [];

	for (const match of markdown.matchAll(FENCED_LATEX_RE)) {
		blocks.push({ latex: match[1] ?? "", label: "fenced LaTeX block" });
	}

	const withoutFences = markdown.replace(FENCED_LATEX_RE, "");
	for (const match of withoutFences.matchAll(DISPLAY_LATEX_RE)) {
		blocks.push({ latex: match[1] ?? "", label: "display math block" });
	}

	const withoutDisplayMath = withoutFences.replace(DISPLAY_LATEX_RE, "");
	for (const match of withoutDisplayMath.matchAll(INLINE_LATEX_RE)) {
		blocks.push({ latex: match[2] ?? "", label: "inline math block" });
	}

	return blocks;
}

export function findInvalidLatex(markdown: string) {
	const errors: string[] = [];

	for (const block of extractLatexBlocks(markdown)) {
		if (block.latex.trim() === "") {
			errors.push(`${block.label}: empty expression`);
			continue;
		}

		try {
			katex.renderToString(block.latex, {
				output: "mathml",
				strict: "error",
				throwOnError: true,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Invalid LaTeX";
			errors.push(`${block.label}: ${message}`);
		}
	}

	return errors;
}

export async function repairInvalidLatex(
	runner: AgentRunner,
	parts: MessagePart[],
) {
	const repairedParts: MessagePart[] = [];

	for (const part of parts) {
		if (part.type !== "text") {
			repairedParts.push(part);
			continue;
		}

		const errors = findInvalidLatex(part.content);
		if (errors.length === 0) {
			repairedParts.push(part);
			continue;
		}

		runner.announce("Correcting math formatting");
		const corrected = await runner.llmCall({
			name: "repair_latex",
			stepType: "validation",
			instructions: [
				"Correct only the invalid LaTeX in the response.",
				"Preserve all prose, structure, and meaning.",
				"Use $...$ for inline math and $$...$$ for display math.",
				"Do not wrap the complete response in a code fence.",
				"Return only the complete corrected response.",
			].join("\n"),
			input: JSON.stringify({ response: part.content, errors }),
		});

		if (findInvalidLatex(corrected).length === 0) {
			repairedParts.push({ ...part, content: corrected });
			continue;
		}

		// Keep the original response if the repair call still produces invalid math.
		repairedParts.push(part);
	}

	return repairedParts;
}
