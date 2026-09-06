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
const FENCED_CODE_SEGMENT_RE = /```[^\n]*(?:\n[\s\S]*?```|$)/g;

function normalizeUnfencedMath(markdown: string) {
	return markdown
		.replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `$$${body}$$`)
		.replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)
		.split("\n")
		.map((line) => {
			const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
			const content = line.trim();
			if (content.startsWith("$") && !content.startsWith("$$") && content.endsWith("$$")) {
				return `${leadingWhitespace}$$${content.slice(1, -2)}$$`;
			}
			if (/^\\[a-zA-Z]+/.test(content) && content.endsWith("$$")) {
				return `${leadingWhitespace}$$${content.slice(0, -2)}$$`;
			}
			return line;
		})
		.join("\n");
}

export function normalizeResponseMath(markdown: string) {
	let normalized = "";
	let cursor = 0;

	for (const match of markdown.matchAll(FENCED_CODE_SEGMENT_RE)) {
		const start = match.index;
		normalized += normalizeUnfencedMath(markdown.slice(cursor, start));
		normalized += match[0];
		cursor = start + match[0].length;
	}

	return normalized + normalizeUnfencedMath(markdown.slice(cursor));
}

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

		const normalized = normalizeResponseMath(part.content);
		const errors = [
			...findInvalidLatex(normalized),
			...findInvalidMermaid(normalized),
		];
		if (errors.length === 0) {
			repairedParts.push({ ...part, content: normalized });
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
			input: JSON.stringify({ response: normalized, errors }),
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
