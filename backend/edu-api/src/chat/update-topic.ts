import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../../db/client";
import { agentRun, agentStep } from "../../db/schema";
import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	ProposedUpdateSchema,
	TopicUpdateSchema,
	type TopicUpdate,
} from "../agents/parsed-output";
import { buildSystemContext, type AgentContext } from "./context";
import {
	createTopicMessage,
	toResponseMessage,
} from "../messages/persistence";
import { optionsPart, textPart } from "../messages/parts";
import {
	updateCurrentPart,
	updateTopicState,
} from "../topics/repository";

export async function executeUpdateTopic(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	message: string,
	topicId: string,
) {
	const pending = await findPendingUpdate(db, topicId);
	if (pending && isConfirmation(message)) {
		return applyUpdate(db, context, topicId, pending);
	}
	if (pending && isRejection(message)) {
		const msg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [
				textPart("Update cancelled. What would you like to do?"),
			],
		});
		return { messages: [toResponseMessage(msg)] };
	}

	if (message.length > 0) {
		return applyUpdateDirect(db, runner, context, topicId, message);
	}

	const systemContext = buildSystemContext(context);

	const proposed = await runner.llmCall({
		name: "propose_update",
		instructions: [
			systemContext,
			"",
			"The user may want to change their learning plan.",
			"Determine if this is an explicit update request or just a question.",
			'Respond in JSON: {"shouldUpdate": boolean, "title": string, "summary": string, "part": string, "explanation": string}',
			"If shouldUpdate is false, explain why no update is needed.",
		].join("\n"),
		input: message,
	});

	const parsed = parseJsonFromLlm(ProposedUpdateSchema, proposed, {
		shouldUpdate: false,
		explanation: proposed,
	});

	if (!parsed.shouldUpdate) {
		const msg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [
				textPart(
					parsed.explanation ?? "No update needed for this request.",
				),
			],
		});
		return { messages: [toResponseMessage(msg)] };
	}

	await runner.recordRoutingStep("pending_topic_update", {}, parsed);

	const msg = await createTopicMessage(db, {
		topicId,
		role: "agent",
		parts: [
			textPart(
				`${parsed.explanation ?? "I'd like to update your learning plan:"}\n\n` +
					`Title: ${parsed.title ?? context.topic?.title}\n` +
					`Focus: ${parsed.part ?? context.topic?.part}\n\n` +
					"Reply confirm to apply or cancel to keep the current plan.",
			),
			optionsPart(["Confirm update", "Cancel"]),
		],
	});

	return {
		messages: [toResponseMessage(msg)],
	};
}

async function applyUpdateDirect(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	topicId: string,
	message: string,
) {
	const systemContext = buildSystemContext(context);

	const generated = await runner.llmCall({
		name: "generate_update",
		instructions: [
			systemContext,
			"",
			"Apply the user's requested update to the learning plan.",
			'Respond in JSON: {"title": string, "summary": string, "part": string}',
		].join("\n"),
		input: message,
	});

	const update = parseJsonFromLlm(TopicUpdateSchema, generated, {
		summary: generated,
	});
	return applyUpdate(db, context, topicId, update);
}

async function applyUpdate(
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
		await updateCurrentPart(db, context.userId, update.part);
	}

	const part = update.part ?? context.topic?.part ?? "the current topic";
	const title = update.title ?? context.topic?.title ?? "this topic";

	const msg = await createTopicMessage(db, {
		topicId,
		role: "agent",
		parts: [
			textPart("Learning plan updated!"),
			optionsPart([`What's ${part}?`, `Test me on ${title}`]),
		],
	});

	return {
		messages: [toResponseMessage(msg)],
	};
}

async function findPendingUpdate(db: Db, topicId: string) {
	const rows = await db
		.select({ output: agentStep.output })
		.from(agentStep)
		.innerJoin(agentRun, eq(agentStep.runId, agentRun.id))
		.where(
			and(
				eq(agentRun.topicId, topicId),
				eq(agentStep.name, "pending_topic_update"),
			),
		)
		.orderBy(desc(agentStep.createdAt))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	const parsed = ProposedUpdateSchema.safeParse(row.output);
	if (parsed.success && parsed.data.shouldUpdate) {
		return parsed.data;
	}
	return null;
}

function isConfirmation(message: string) {
	const lower = message.toLowerCase().trim();
	if (lower === "confirm" || lower === "yes") {
		return true;
	}
	return lower.includes("confirm update");
}

function isRejection(message: string) {
	const lower = message.toLowerCase().trim();
	return lower === "cancel" || lower === "no";
}
