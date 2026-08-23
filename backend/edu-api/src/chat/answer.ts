import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	QuestionIdentificationSchema,
} from "../agents/parsed-output";
import { buildSystemContext, type AgentContext } from "./context";
import { lastPracticeQuestion } from "./intent";
import { optionsPart, textPart } from "../messages/parts";
import type { MessagePart } from "../messages/schema";
import { MATH_MARKDOWN_RULE, shortFocus } from "./option-label";
import { determineDomain, verifySolution } from "../verification/verify";

export async function executeAnswer(
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	onDelta: (text: string) => void,
	questionOverride?: string,
) {
	const systemContext = buildSystemContext(context);

	let question =
		questionOverride ?? lastPracticeQuestion(context.recentMessages) ?? "";
	if (question === "") {
		runner.announce("Identifying the question");
		const questionResult = await runner.llmCall({
			name: "identify_question",
			instructions: [
				systemContext,
				"",
				"Identify the question or problem the user is trying to answer.",
				'Respond in JSON: {"found": boolean, "question": string, "candidates": string[]}',
				"If no question found, set found to false.",
				"If multiple possible questions, list them in candidates.",
			].join("\n"),
			input: message,
		});

		const identified = parseJsonFromLlm(
			QuestionIdentificationSchema,
			questionResult,
		);

		if (!identified || !identified.found) {
			return {
				parts: [
					textPart("No question found. What are you trying to answer?"),
				],
			};
		}

		if (identified.candidates.length > 1) {
			return {
				parts: [optionsPart(identified.candidates)],
			};
		}

		question = identified.question;
	}

	runner.announce("Checking your answer");
	const domain = await determineDomain(
		runner,
		context.topic?.summary ?? "",
	);

	if (domain !== "STEM") {
		return {
			parts: [textPart("Currently supports STEM subjects.")],
		};
	}

	const verification = await verifySolution(runner, {
		question,
		solution: message,
		domain,
	});

	runner.announce("Writing a response");
	const responseText = await runner.llmStream({
		name: "generate_response",
		instructions: [
			systemContext,
			"",
			"Based on the verification results, explain what is correct, what is incorrect and why, and what the learner should do next.",
			"Be encouraging but precise.",
			"Do not offer hints as follow-up options.",
			MATH_MARKDOWN_RULE,
		].join("\n"),
		input: JSON.stringify({ question, verification }),
		onChunk: onDelta,
	});

	const part = shortFocus(context.topic?.part ?? "the current topic");
	let followUpLabels: string[];
	if (verification.correct) {
		followUpLabels = [
			`Proceed with ${part}`,
			`Try another question on ${part}`,
		];
	} else {
		followUpLabels = ["Try a similar question"];
	}

	const parts: MessagePart[] = [
		textPart(responseText),
		optionsPart(followUpLabels),
	];

	return { parts };
}

export async function executeExplanation(
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	onDelta: (text: string) => void,
) {
	const systemContext = buildSystemContext(context);
	const responseText = await runner.llmStream({
		name: "generate_response",
		instructions: [
			systemContext,
			"",
			"Answer the student's question clearly. Do not grade them. Do not change the learning plan.",
			MATH_MARKDOWN_RULE,
		].join("\n"),
		input: message,
		onChunk: onDelta,
	});

	return {
		parts: [textPart(responseText)],
	};
}
