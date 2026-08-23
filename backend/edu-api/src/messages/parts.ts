import {
	AttachmentPartSchema,
	OptionsPartSchema,
	TextPartSchema,
	type MessagePart,
} from "./schema";

export function textPart(content: string) {
	return TextPartSchema.parse({ type: "text", content });
}

export function optionsPart(labels: string[]) {
	return OptionsPartSchema.parse({
		type: "options",
		options: labels.map((label) => ({ label })),
	});
}

export function attachmentPart(ref: string) {
	return AttachmentPartSchema.parse({ type: "attachment", ref });
}

export function partsToText(parts: MessagePart[]) {
	const lines: string[] = [];
	for (const part of parts) {
		if (part.type === "text") {
			lines.push(part.content);
		}
		if (part.type === "attachment") {
			lines.push(`[attachment: ${part.ref}]`);
		}
		if (part.type === "options") {
			lines.push(part.options.map((option) => option.label).join(", "));
		}
	}
	return lines.join("\n").trim();
}
