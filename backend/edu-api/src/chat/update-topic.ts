import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	TopicUpdateSchema,
	type TopicUpdate,
} from "../agents/parsed-output";
import { buildSystemContext, type AgentContext } from "./context";
import { optionLabel, shortFocus, TOPIC_PART_RULE } from "./option-label";
import { optionsPart, textPart } from "../messages/parts";
import {
	updateCurrentPart,
	updateTopicState,
} from "../topics/repository";

export async function generateTopicUpdate(
	runner: AgentRunner,
	context: AgentContext,
	message: string,
) {
	const systemContext = buildSystemContext(context);
	const generated = await runner.llmCall({
		name: "generate_update",
		instructions: [
			systemContext,
			"",
			"Apply the user's requested update to the learning plan.",
			`Respond in JSON: {"title": string, "summary": string, "part": string}. ${TOPIC_PART_RULE}`,
		].join("\n"),
		input: message,
	});

	return parseJsonFromLlm(TopicUpdateSchema, generated);
}

export async function applyTopicUpdate(
	db: Db,
	context: AgentContext,
	topicId: string,
	update: TopicUpdate,
) {
	const topicUpdates: { title?: string; summary?: string } = {};
	if (update.title) {
		topicUpdates.title = update.title;
	}
	if (update.summary) {
		topicUpdates.summary = update.summary;
	}

	if (Object.keys(topicUpdates).length > 0) {
		await updateTopicState(db, topicId, topicUpdates);
	}

	if (update.part) {
		await updateCurrentPart(db, context.userId, shortFocus(update.part));
	}

	const part = shortFocus(
		update.part ?? context.topic?.part ?? "the current topic",
	);
	const title = shortFocus(
		update.title ?? context.topic?.title ?? "this topic",
	);

	return {
		parts: [
			textPart("Learning plan updated!"),
			optionsPart([optionLabel("What's", part) + "?", optionLabel("Test me on", title)]),
		],
	};
}
