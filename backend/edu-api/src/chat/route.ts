import type { Db } from "../../db/client";
import { createAgentRun } from "../agents/runner";
import { callLlm, type LlmEnv } from "../agents/llm";
import {
	parseJsonFromLlm,
	TopicGenerationSchema,
} from "../agents/parsed-output";
import { executeAnswer } from "./answer";
import {
	loadChatContext,
	maybeScheduleSummaryUpdate,
} from "./context";
import { deduceIntent, parseExplicitCommand } from "./intent";
import { executeNewQuestion } from "./new-question";
import { executeNewTopicContinuation } from "./new-topic";
import { executeUpdateTopic } from "./update-topic";
import {
	createTopicMessage,
	toResponseMessage,
} from "../messages/persistence";
import { partsToText, textPart, optionsPart } from "../messages/parts";
import { ChatRequestSchema, type ChatRequest } from "../messages/schema";
import {
	createTopic,
	setCurrentTopic,
} from "../topics/repository";

export async function handleChat(
	db: Db,
	llmEnv: LlmEnv,
	userId: string,
	body: object,
) {
	const parsed = ChatRequestSchema.parse(body);
	const messageText = partsToText(parsed.parts);

	const context = await loadChatContext(db, userId, messageText);

	if (!context.topic) {
		return handleNoTopic(db, llmEnv, userId, parsed, context);
	}

	const topicId = context.topic.id;

	const userMsg = await createTopicMessage(db, {
		id: parsed.message,
		topicId,
		role: "user",
		parts: parsed.parts,
	});

	const runner = await createAgentRun(db, llmEnv, {
		topicId,
		userMessageId: userMsg.id,
		intent: null,
	});

	try {
		const intent = await deduceIntent(messageText, context, runner);

		const outputMessages = await dispatchIntent(
			db,
			runner,
			context,
			intent,
			topicId,
		);

		await runner.complete();
		await maybeScheduleSummaryUpdate(db, runner, topicId, userId);

		return {
			messages: outputMessages,
			runId: runner.runId,
			topicId,
		};
	} catch (error) {
		await runner.fail(error instanceof Error ? error : String(error));

		const errorMsg = await createTopicMessage(db, {
			topicId,
			role: "agent",
			parts: [
				textPart("I couldn't complete that request. Please try again."),
			],
		});

		return {
			messages: [toResponseMessage(errorMsg)],
			runId: runner.runId,
			topicId,
		};
	}
}

async function handleNoTopic(
	db: Db,
	llmEnv: LlmEnv,
	userId: string,
	request: ChatRequest,
	context: Awaited<ReturnType<typeof loadChatContext>>,
) {
	const messageText = partsToText(request.parts);
	const explicit = parseExplicitCommand(messageText);
	const topicContent = explicit?.message || messageText || "General learning";

	const generated = await callLlm(llmEnv, {
		instructions: [
			"Generate a learning topic from the user's request.",
			'Respond in JSON: {"title": string, "summary": string, "part": string}',
			"summary must be plain text describing what the student is learning.",
			"part is a short semantic description of where to start.",
		].join("\n"),
		input: topicContent,
	});

	const topicMeta = parseJsonFromLlm(TopicGenerationSchema, generated.text, {
		title: topicContent.slice(0, 80),
		summary: `Student wants to learn about ${topicContent}.`,
		part: "understanding the basics",
	});

	const topic = await createTopic(db, {
		userId,
		title: topicMeta.title,
		summary: topicMeta.summary,
		part: topicMeta.part,
	});

	await setCurrentTopic(db, userId, topic.id, topicMeta.part);

	const userMsg = await createTopicMessage(db, {
		id: request.message,
		topicId: topic.id,
		role: "user",
		parts: request.parts,
	});

	const runner = await createAgentRun(db, llmEnv, {
		topicId: topic.id,
		userMessageId: userMsg.id,
		intent: "new-topic",
	});

	try {
		const result = await executeNewTopicContinuation(
			db,
			runner,
			{
				...context,
				topic: {
					id: topic.id,
					title: topicMeta.title,
					summary: topicMeta.summary,
					part: topicMeta.part,
				},
			},
			topicMeta,
		);

		await runner.complete();

		return {
			messages: result.messages,
			runId: runner.runId,
			topicId: topic.id,
		};
	} catch (error) {
		await runner.fail(error instanceof Error ? error : String(error));
		return {
			messages: [
				toResponseMessage({
					id: "error",
					topicId: topic.id,
					role: "agent",
					parts: [
						textPart(
							"I couldn't complete that request. Please try again.",
						),
					],
					createdAt: new Date(),
				}),
			],
			runId: runner.runId,
			topicId: topic.id,
		};
	}
}

async function dispatchIntent(
	db: Db,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	context: Awaited<ReturnType<typeof loadChatContext>>,
	intent: Awaited<ReturnType<typeof deduceIntent>>,
	topicId: string,
) {
	switch (intent.type) {
		case "new-topic": {
			const generated = await runner.llmCall({
				name: "generate_topic",
				instructions: [
					"Generate a learning topic from the user's request.",
					'Respond in JSON: {"title": string, "summary": string, "part": string}',
				].join("\n"),
				input: intent.message || "General learning",
			});
			const topicMeta = parseJsonFromLlm(
				TopicGenerationSchema,
				generated,
				{
					title: (intent.message || "General learning").slice(0, 80),
					summary: `Student wants to learn about ${intent.message || "this topic"}.`,
					part: "understanding the basics",
				},
			);
			const topic = await createTopic(db, {
				userId: context.userId,
				title: topicMeta.title,
				summary: topicMeta.summary,
				part: topicMeta.part,
			});
			await setCurrentTopic(db, context.userId, topic.id, topicMeta.part);
			const result = await executeNewTopicContinuation(
				db,
				runner,
				{
					...context,
					topic: {
						id: topic.id,
						title: topicMeta.title,
						summary: topicMeta.summary,
						part: topicMeta.part,
					},
				},
				topicMeta,
			);
			return result.messages;
		}

		case "update-topic": {
			const { messages } = await executeUpdateTopic(
				db,
				runner,
				context,
				intent.message,
				topicId,
			);
			return messages;
		}

		case "new-question": {
			const { messages } = await executeNewQuestion(
				db,
				runner,
				context,
				intent.message,
				topicId,
			);
			return messages;
		}

		case "answer":
		default: {
			const { messages } = await executeAnswer(
				db,
				runner,
				context,
				intent.message,
				topicId,
			);
			return messages;
		}
	}
}
