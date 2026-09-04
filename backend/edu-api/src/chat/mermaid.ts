const MERMAID_BLOCK_RE = /```mermaid[^\n]*\n([\s\S]*?)```/gi;
const MERMAID_DIRECTIVE_RE =
	/^(?:---[\s\S]*?---\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta)\b/;

export function extractMermaidBlocks(markdown: string) {
	return [...markdown.matchAll(MERMAID_BLOCK_RE)].map((match) => {
		return match[1] ?? "";
	});
}

export function findInvalidMermaid(markdown: string) {
	const errors: string[] = [];
	const blocks = extractMermaidBlocks(markdown);
	const withoutCompleteBlocks = markdown.replace(MERMAID_BLOCK_RE, "");

	if (/```mermaid\b/i.test(withoutCompleteBlocks)) {
		errors.push("unclosed Mermaid code block");
	}

	for (const block of blocks) {
		if (block.trim() === "") {
			errors.push("empty Mermaid code block");
			continue;
		}

		if (!MERMAID_DIRECTIVE_RE.test(block.trimStart())) {
			errors.push("Mermaid code block: missing or unsupported diagram directive");
		}
	}

	return errors;
}
