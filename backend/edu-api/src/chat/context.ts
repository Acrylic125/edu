import type { Db } from "../../db/client";
import type { PersistedTopicMessage } from "../messages/schema";
import {
	countTopicMessages,
	formatMessageForModel,
	loadRecentMessages,
} from "../messages/persistence";
import { getCurrentTopic } from "../topics/repository";
import type { AgentRunner } from "../agents/runner";

export type AgentContext = {
	userId: string;
	topic: {
		id: string;
		title: string;
		summary: string;
		part: string | null;
	} | null;
	recentMessages: PersistedTopicMessage[];
	currentMessage: string;
};

export async function loadChatContext(
	db: Db,
	userId: string,
	currentMessage: string,
) {
	const current = await getCurrentTopic(db, userId);

	if (!current) {
		return {
			userId,
			topic: null,
			recentMessages: [],
			currentMessage,
		};
	}

	const recentMessages = await loadRecentMessages(db, current.topic.id, 8);

	return {
		userId,
		topic: {
			id: current.topic.id,
			title: current.topic.title,
			summary: current.topic.summary,
			part: current.part,
		},
		recentMessages,
		currentMessage,
	};
}

export function formatMessagesForModel(messages: PersistedTopicMessage[]) {
	return messages.map(formatMessageForModel).join("\n\n");
}

export function buildSystemContext(context: AgentContext) {
	const sections: string[] = [
		"You are an educational assistant helping a student learn.",
	];

	if (context.topic) {
		sections.push(`Topic: ${context.topic.title}`);
		sections.push(`Summary: ${context.topic.summary}`);
		if (context.topic.part) {
			sections.push(`Current focus: ${context.topic.part}`);
		}
	}

	if (context.recentMessages.length > 0) {
		sections.push("Recent conversation:");
		sections.push(formatMessagesForModel(context.recentMessages));
	}

	return sections.join("\n\n");
}

const SUMMARY_THRESHOLD = 20;

export async function maybeScheduleSummaryUpdate(
	db: Db,
	runner: AgentRunner,
	topicId: string,
	userId: string,
) {
	try {
		const count = await countTopicMessages(db, topicId);
		if (count < SUMMARY_THRESHOLD) {
			return;
		}

		const { updateTopicSummary } = await import("../topics/summary");
		await updateTopicSummary(db, runner, topicId, userId);
	} catch (error) {
		console.error("Summary update failed (non-blocking):", error);
	}
}
