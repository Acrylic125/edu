const LEAD_IN =
	/^(begin with|start with|start by|focus on|study|explore|develop|next,?\s+|finally,?\s+|then\s+)/i;

const STOP = new Set(["and", "then", "as", "or", "with", "for"]);

export const MATH_MARKDOWN_RULE =
	"Write math in markdown: $x$ for inline, $$...$$ for display (including matrices). Do not use \\[ \\], \\( \\), or \\boxed; use \\mathbf to emphasize a result.";

export const TOPIC_PART_RULE =
	'"part" is a 1-4 word focus label (e.g. "Vectors"), never a sentence or paragraph.';

export function shortFocus(text: string) {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return "this topic";
	}
	if (trimmed.length <= 32 && !/[.!?,]/.test(trimmed)) {
		return trimmed;
	}

	let rest = trimmed;
	while (true) {
		const next = rest.replace(LEAD_IN, "").trim();
		if (next === rest) {
			break;
		}
		rest = next;
	}

	const clause = rest.split(/[.,;:]/)[0] ?? rest;
	const words = clause.trim().split(/\s+/);
	const keep: string[] = [];
	for (const word of words) {
		if (STOP.has(word.toLowerCase()) && keep.length > 0) {
			break;
		}
		keep.push(word);
		if (keep.length >= 3) {
			break;
		}
	}
	if (keep.length === 0) {
		return "this topic";
	}
	const label = keep.join(" ");
	const first = label[0];
	if (!first) {
		return "this topic";
	}
	return first.toUpperCase() + label.slice(1);
}

export function optionLabel(verb: string, topic: string) {
	return `${verb} ${shortFocus(topic)}`;
}
