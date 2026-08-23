import type { AgentRunner } from "../agents/runner";
import { buildSystemContext, type AgentContext } from "./context";
import { lastPracticeQuestion } from "./intent";
import {
	MATH_MARKDOWN_RULE,
	optionLabel,
	shortFocus,
} from "./option-label";
import { optionsPart, textPart } from "../messages/parts";
import type { MessagePart } from "../messages/schema";

export async function executeNewQuestion(
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	onDelta: (text: string) => void,
) {
	const systemContext = buildSystemContext(context);
	const part = shortFocus(context.topic?.part ?? "the current topic");
	const previous = lastPracticeQuestion(context.recentMessages);

	runner.announce("Writing a question");
	const instructions = [
		systemContext,
		"",
		`Generate a practice question appropriate for: ${part}`,
		"Write a variant of the last practice question.",
		"Keep the same skill and structure.",
		"Change the numbers and the concrete setup so it is not a copy.",
		"Do not switch topics or skills.",
		"Consider the student's demonstrated proficiency and recent mistakes.",
		"Do not include hints.",
		MATH_MARKDOWN_RULE,
	];
	if (previous) {
		instructions.push("", "Last practice question:", previous);
	}

	const questionText = await runner.llmStream({
		name: "generate_question",
		instructions: instructions.join("\n"),
		input: message || `Generate a similar question on ${part}`,
		onChunk: onDelta,
	});

	const parts: MessagePart[] = [
		textPart(questionText),
		optionsPart(["Another question", optionLabel("Explain", part)]),
	];

	return { parts };
}
