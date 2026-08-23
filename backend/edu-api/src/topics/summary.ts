import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import {
	formatMessageForModel,
	loadRecentMessages,
} from "../messages/persistence";
import { getTopicForUser, updateTopicState } from "../topics/repository";

export async function updateTopicSummary(
	db: Db,
	runner: AgentRunner,
	topicId: string,
	userId: string,
) {
	const topic = await getTopicForUser(db, topicId, userId);
	if (!topic) {
		return;
	}

	const recentMessages = await loadRecentMessages(db, topicId, 16);

	const historyText = recentMessages
		.map(formatMessageForModel)
		.join("\n\n");

	const newSummary = await runner.llmCall({
		name: "update_summary",
		instructions: [
			"Update the learning topic summary based on recent conversation.",
			"The summary must be plain text with no structured format.",
			"Incorporate the student's current understanding and struggles.",
			"Respond with only the new summary text.",
		].join("\n"),
		input: [
			`Existing summary:\n${topic.summary}`,
			`\nRecent history:\n${historyText}`,
		].join("\n"),
	});

	await updateTopicState(db, topicId, { summary: newSummary.trim() });
}
