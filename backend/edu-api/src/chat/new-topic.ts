import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import { buildSystemContext, type AgentContext } from "./context";
import {
	createTopicMessage,
	toResponseMessage,
} from "../messages/persistence";
import { optionsPart, textPart } from "../messages/parts";

export async function executeNewTopicContinuation(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	parsed: { title: string; summary: string; part: string },
) {
	const topicId = context.topic!.id;

	const welcomeText = await runner.llmCall({
		name: "generate_welcome",
		instructions: buildSystemContext(context),
		input: "Write a brief welcome message introducing this topic to the student.",
	});

	const msg = await createTopicMessage(db, {
		topicId,
		role: "agent",
		parts: [
			textPart(welcomeText),
			optionsPart([
				`What's ${parsed.title}?`,
				`Test me on ${parsed.title}`,
			]),
		],
	});

	return {
		messages: [toResponseMessage(msg)],
	};
}
