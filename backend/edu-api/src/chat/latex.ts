import katex from "katex";

import type { AgentRunner } from "../agents/runner";
import type { MessagePart } from "../messages/schema";
import { findInvalidMermaid } from "./mermaid";

type LatexBlock = {
	latex: string;
	label: string;
};

const FENCED_LATEX_RE = /```(?:latex|tex)\s*\n([\s\S]*?)```/gi;
const FENCED_CODE_RE = /```[^\n]*\n[\s\S]*?```/g;

function isEscaped(value: string, index: number) {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor--) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function extractDollarLatex(markdown: string) {
	const blocks: LatexBlock[] = [];
	const errors: string[] = [];
	const source = markdown.replace(FENCED_CODE_RE, "");
	let cursor = 0;

	while (cursor < source.length) {
		if (source[cursor] !== "$" || isEscaped(source, cursor)) {
			cursor += 1;
			continue;
		}

		const display = source[cursor + 1] === "$";
		const delimiter = display ? "$$" : "$";
		const contentStart = cursor + delimiter.length;
		let closing = contentStart;

		while (closing < source.length) {
			if (!display && source[closing] === "\n") {
				break;
			}
			if (
				source.startsWith(delimiter, closing) &&
				!isEscaped(source, closing) &&
				(display || source[closing + 1] !== "$")
			) {
				break;
			}
			closing += 1;
		}

		if (!source.startsWith(delimiter, closing)) {
			errors.push(`unclosed ${display ? "display" : "inline"} math delimiter`);
			cursor = contentStart;
			continue;
		}

		blocks.push({
			latex: source.slice(contentStart, closing),
			label: display ? "display math block" : "inline math block",
		});
		cursor = closing + delimiter.length;
	}

	return { blocks, errors };
}

export function extractLatexBlocks(markdown: string) {
	const blocks: LatexBlock[] = [];

	for (const match of markdown.matchAll(FENCED_LATEX_RE)) {
		blocks.push({ latex: match[1] ?? "", label: "fenced LaTeX block" });
	}


	blocks.push(...extractDollarLatex(markdown).blocks);

	return blocks;
}

export function findInvalidLatex(markdown: string) {
	const { errors } = extractDollarLatex(markdown);
	const withoutCompleteFences = markdown.replace(FENCED_CODE_RE, "");
	if (/```(?:latex|tex)\b/i.test(withoutCompleteFences)) {
		errors.push("unclosed fenced LaTeX block");
	}

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

function neutralizeRichMarkup(markdown: string) {
	return markdown
		.replace(/```(?:mermaid|latex|tex)\b/gi, "```text")
		.replace(/(^|[^\\])\$/g, "$1\\$");
}

export async function repairInvalidResponseMarkup(
	runner: AgentRunner,
	parts: MessagePart[],
) {
	const repairedParts: MessagePart[] = [];

	for (const part of parts) {
		if (part.type !== "text") {
			repairedParts.push(part);
			continue;
		}

		const errors = [
			...findInvalidLatex(part.content),
			...findInvalidMermaid(part.content),
		];
		if (errors.length === 0) {
			repairedParts.push(part);
			continue;
		}

		runner.announce("Correcting math formatting");
		const corrected = await runner.llmCall({
			name: "repair_response_markup",
			stepType: "validation",
			instructions: [
				"Correct only the invalid LaTeX or Mermaid syntax in the response.",
				"Preserve all prose, structure, and meaning.",
				"Use $...$ for inline math and $$...$$ for display math.",
				"Keep Mermaid diagrams inside complete fenced ```mermaid blocks.",
				"Do not wrap the complete response in a code fence.",
				"Return only the complete corrected response.",
			].join("\n"),
			input: JSON.stringify({ response: part.content, errors }),
		});

		const correctedErrors = [
			...findInvalidLatex(corrected),
			...findInvalidMermaid(corrected),
		];
		if (correctedErrors.length === 0) {
			repairedParts.push({ ...part, content: corrected });
			continue;
		}

		// Preserve the content as inert text if the repair cannot produce safe markup.
		repairedParts.push({
			...part,
			content: neutralizeRichMarkup(corrected),
		});
	}

	return repairedParts;
}
