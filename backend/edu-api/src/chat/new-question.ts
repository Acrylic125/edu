import type { AgentRunner } from "../agents/runner";
import { buildSystemContext, type AgentContext } from "./context";
import { practiceQuestionHistory } from "./intent";
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
	const previousQuestions = practiceQuestionHistory(context.recentMessages);

	runner.announce("Writing a question");
	const instructions = [
		systemContext,
		"",
		`Generate a practice question appropriate for: ${part}`,
		"Use the practice-question history below as an exclusion index.",
		"Do not repeat the same underlying task, theorem, identity, operands, answer, or problem structure.",
		"Do not merely rename variables or change the story around an equivalent question.",
		"Choose a materially different skill within the current topic when the recent history already covers this skill.",
		"Stay within the current topic and learner level.",
		"Consider the student's demonstrated proficiency and recent mistakes.",
		"Do not include hints.",
		MATH_MARKDOWN_RULE,
	];
	if (previousQuestions.length > 0) {
		instructions.push(
			"",
			"Recent practice-question exclusion history (do not repeat these):",
			...previousQuestions.map((question, index) => `${index + 1}. ${question}`),
		);
	}
	if (context.memorySummaries && context.memorySummaries.length > 0) {
		instructions.push(
			"",
			"Retrieved memory index (also treat these prior outcomes as exclusions):",
			...context.memorySummaries.map(
				(memory) => `- [${memory.id}] ${memory.summary}`,
			),
		);
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
