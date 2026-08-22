import type { ChatTurn } from "../types/messages";

export const LUNA_MODEL = "openai/gpt-5.6-luna" as const;

const SYSTEM_INSTRUCTIONS =
	"You are a helpful educational assistant. Answer clearly and concisely.";

type LunaResponse = {
	output_text?: string;
	output?: Array<{
		type?: string;
		content?: Array<{
			type?: string;
			text?: string;
		}>;
	}>;
	error?: {
		message?: string;
	} | null;
};

function extractOutputText(response: LunaResponse): string {
	if (response.output_text?.trim()) {
		return response.output_text.trim();
	}

	for (const item of response.output ?? []) {
		if (item.type !== "message") {
			continue;
		}

		for (const content of item.content ?? []) {
			if (content.type === "output_text" && content.text?.trim()) {
				return content.text.trim();
			}
		}
	}

	if (response.error?.message) {
		throw new Error(response.error.message);
	}

	throw new Error("No response from model");
}

function formatConversation(history: ChatTurn[], userMessage: string): string {
	const lines = history.map((turn) => `${turn.role}: ${turn.content}`);
	lines.push(`user: ${userMessage}`);
	return lines.join("\n\n");
}

export async function runLunaAgent(
	ai: Ai,
	history: ChatTurn[],
	userMessage: string,
): Promise<string> {
	const response = (await ai.run(LUNA_MODEL, {
		instructions: SYSTEM_INSTRUCTIONS,
		input: formatConversation(history, userMessage),
		max_output_tokens: 1024,
	})) as LunaResponse;

	return extractOutputText(response);
}
