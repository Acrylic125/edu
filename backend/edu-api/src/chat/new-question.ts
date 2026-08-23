import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import { buildSystemContext, type AgentContext } from "./context";
import {
	createTopicMessage,
	toResponseMessage,
} from "../messages/persistence";
import { optionsPart, textPart } from "../messages/parts";

export async function executeNewQuestion(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	topicId: string,
) {
	const systemContext = buildSystemContext(context);
	const part = context.topic?.part ?? "the current topic";

	const questionText = await runner.llmCall({
		name: "generate_question",
		instructions: [
			systemContext,
			"",
			`Generate a practice question appropriate for: ${part}`,
			"Consider the student's demonstrated proficiency and recent mistakes.",
			"Do not repeat questions from recent history.",
			"Write a clear, specific question.",
		].join("\n"),
		input: message || `Generate a question on ${part}`,
	});

	const msg = await createTopicMessage(db, {
		topicId,
		role: "agent",
		parts: [
			textPart(questionText),
			optionsPart([
				"Give me a hint",
				"Another question",
				`Explain ${part}`,
			]),
		],
	});

	return {
		messages: [toResponseMessage(msg)],
	};
}
