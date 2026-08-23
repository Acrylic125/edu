import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	QuestionIdentificationSchema,
} from "../agents/parsed-output";
import { buildSystemContext, type AgentContext } from "./context";
import {
	createTopicMessage,
	toResponseMessage,
} from "../messages/persistence";
import { optionsPart, textPart } from "../messages/parts";
import { determineDomain, verifySolution } from "../verification/verify";

export async function executeAnswer(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	topicId: string,
) {
	const systemContext = buildSystemContext(context);

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
		{ found: true, question: questionResult, candidates: [] },
	);

	if (!identified.found) {
		const msg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [
				textPart("No question found. What are you trying to answer?"),
			],
		});
		return { messages: [toResponseMessage(msg)] };
	}

	if (identified.candidates.length > 1) {
		const msg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [optionsPart(identified.candidates)],
		});
		return { messages: [toResponseMessage(msg)] };
	}

	const question = identified.question;

	const domain = await determineDomain(
		runner,
		context.topic?.summary ?? "",
	);

	if (domain !== "STEM") {
		const msg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [textPart("Currently supports STEM subjects.")],
		});
		return { messages: [toResponseMessage(msg)] };
	}

	const verification = await verifySolution(runner, {
		question,
		solution: message,
		domain,
	});

	const responseText = await runner.llmCall({
		name: "generate_response",
		instructions: [
			systemContext,
			"",
			"Based on the verification results, explain what is correct, what is incorrect and why, and what the learner should do next.",
			"Be encouraging but precise.",
		].join("\n"),
		input: JSON.stringify({ question, verification }),
	});

	const part = context.topic?.part ?? "the current topic";
	let followUpLabels: string[];
	if (verification.correct) {
		followUpLabels = [
			`Proceed with ${part}`,
			`Try another question on ${part}`,
		];
	} else {
		followUpLabels = ["New Related Question"];
	}

	const msg = await createTopicMessage(db, {
		topicId,
		role: "agent",
		parts: [textPart(responseText), optionsPart(followUpLabels)],
	});

	return {
		messages: [toResponseMessage(msg)],
	};
}
