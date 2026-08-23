import type { AgentRunner } from "../agents/runner";
import { buildSystemContext, type AgentContext } from "./context";
import { MATH_MARKDOWN_RULE, optionLabel } from "./option-label";
import { optionsPart, textPart } from "../messages/parts";
import type { MessagePart } from "../messages/schema";

export async function executeNewTopicContinuation(
	runner: AgentRunner,
	context: AgentContext,
	parsed: { title: string; summary: string; part: string },
	onDelta: (text: string) => void,
) {
	const welcomeText = await runner.llmStream({
		name: "generate_welcome",
		instructions: [buildSystemContext(context), MATH_MARKDOWN_RULE].join(
			"\n\n",
		),
		input: "Write a brief welcome message introducing this topic to the student.",
		onChunk: onDelta,
	});

	const parts: MessagePart[] = [
		textPart(welcomeText),
		optionsPart([
			optionLabel("What's", parsed.title) + "?",
			optionLabel("Test me on", parsed.title),
		]),
	];

	return { parts };
}
