import { nanoid } from "nanoid";

import type { Db } from "../../db/client";
import type { AgentImage } from "../assets/load";
import { linkAssetsToMessage } from "../assets/repository";
import { createAgentRun } from "../agents/runner";
import type { LlmEnv } from "../agents/llm";
import {
	parseJsonFromLlm,
	ProposedUpdateSchema,
	QuestionIdentificationSchema,
	TopicGenerationSchema,
} from "../agents/parsed-output";
import { executeAnswer, executeExplanation } from "./answer";
import {
	loadChatContext,
	maybeScheduleSummaryUpdate,
	type AgentContext,
} from "./context";
import {
	deduceObviousIntent,
	inferFromRaw,
	looksLikeNextWithinTopic,
	lastPracticeQuestion,
	parseExplicitCommand,
	type DeducedIntent,
} from "./intent";
import { executeNewQuestion } from "./new-question";
import { executeNewTopicContinuation } from "./new-topic";
import { shortFocus, TOPIC_PART_RULE } from "./option-label";
import { applyTopicUpdate, generateTopicUpdate } from "./update-topic";
import { createTopicMessage, reassignTopicMessage } from "../messages/persistence";
import {
	partsToText,
	proposalPart,
	textPart,
} from "../messages/parts";
import {
	ChatRequestSchema,
	type ChatRequest,
	type MessagePart,
	type Proposal,
} from "../messages/schema";
import { createTopic, setCurrentTopic } from "../topics/repository";
import { flushWords, pushWords } from "./word-buffer";

export type ChatRunIo = {
	signal: AbortSignal;
	runId: string;
	assistantMessageId: string;
	userMessageId: string;
	onDelta: (partIndex: number, text: string) => void;
	onProgress: (label: string) => void;
	images?: AgentImage[];
};

export type StoredProposal = {
	proposalId: string;
	prompt: string;
	proposal: Proposal;
};

export type ChatTurnResult = {
	parts: MessagePart[];
	topicId?: string;
	pendingProposal: StoredProposal | null;
};

export type Route =
	| { type: "command"; intent: DeducedIntent }
	| { type: "reply"; message: string }
	| { type: "proposal"; prompt: string; proposal: Proposal };

function emitVisible(io: ChatRunIo, text: string) {
	const pushed = pushWords("", text);
	if (pushed.flush !== "") {
		io.onDelta(0, pushed.flush);
	}
	const rest = flushWords(pushed.pending);
	if (rest.flush !== "") {
		io.onDelta(0, rest.flush);
	}
}

export async function handleChat(
	db: Db,
	llmEnv: LlmEnv,
	userId: string,
	body: object,
	io: ChatRunIo,
) {
	const parsed = ChatRequestSchema.parse(body);
	let messageText = partsToText(parsed.parts);
	if (io.images && io.images.length > 0) {
		if (messageText === "") {
			messageText = "The user sent image(s). Help with what they show.";
		} else {
			messageText = `${messageText}\n\nThe user also attached ${io.images.length} image(s).`;
		}
	}
	const context = await loadChatContext(db, userId, messageText);

	const runner = await createAgentRun(db, llmEnv, {
		runId: io.runId,
		topicId: context.topic?.id ?? null,
		userMessageId: io.userMessageId,
		intent: null,
		signal: io.signal,
		onProgress: io.onProgress,
		images: io.images,
	});

	try {
		runner.announce("Reading your message");
		const route = await routeMessage(messageText, context, runner);
		const result = await fulfillRoute(
			db,
			runner,
			context,
			io,
			parsed,
			route,
		);
		await runner.complete();
		if (result.topicId) {
			await maybeScheduleSummaryUpdate(
				db,
				runner,
				result.topicId,
				userId,
			);
		}
		return result;
	} catch (error) {
		if (io.signal.aborted) {
			await runner.complete("cancelled");
			throw error;
		}
		await runner.fail(error instanceof Error ? error : String(error));
		return {
			parts: [
				textPart("I couldn't complete that request. Please try again."),
			],
			topicId: context.topic?.id,
			pendingProposal: null,
		};
	}
}

export async function handleDecision(
	db: Db,
	llmEnv: LlmEnv,
	userId: string,
	stored: StoredProposal,
	decision: "accept" | "reject",
	io: ChatRunIo,
) {
	const context = await loadChatContext(db, userId, "");

	if (context.topic) {
		await createTopicMessage(db, {
			id: io.userMessageId,
			topicId: context.topic.id,
			role: "user",
			parts: [textPart(decision === "accept" ? "Confirm" : "Cancel")],
		});
	}

	const runner = await createAgentRun(db, llmEnv, {
		runId: io.runId,
		topicId: context.topic?.id ?? null,
		userMessageId: io.userMessageId,
		intent: stored.proposal.kind,
		signal: io.signal,
		onProgress: io.onProgress,
	});

	try {
		if (decision === "reject") {
			const text = "Okay, I won't do that.";
			emitVisible(io, text);
			await runner.complete();
			return {
				parts: [textPart(text)],
				topicId: context.topic?.id,
				pendingProposal: null,
			};
		}

		const result = await acceptProposal(
			db,
			runner,
			context,
			io,
			stored.proposal,
		);
		await runner.complete();
		if (result.topicId) {
			await maybeScheduleSummaryUpdate(
				db,
				runner,
				result.topicId,
				userId,
			);
		}
		return result;
	} catch (error) {
		if (io.signal.aborted) {
			await runner.complete("cancelled");
			throw error;
		}
		await runner.fail(error instanceof Error ? error : String(error));
		return {
			parts: [
				textPart("I couldn't complete that request. Please try again."),
			],
			topicId: context.topic?.id,
			pendingProposal: null,
		};
	}
}

export async function routeMessage(
	messageText: string,
	context: AgentContext,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
) {
	const explicit = parseExplicitCommand(messageText);
	if (explicit) {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "command", intent: explicit },
		);
		return { type: "command", intent: explicit } satisfies Route;
	}

	if (!context.topic) {
		// Vague "what's next?" with no active topic → chat, don't invent a subject.
		if (looksLikeNextWithinTopic(messageText)) {
			await runner.recordRoutingStep(
				"route",
				{ message: messageText },
				{ type: "reply" },
			);
			return { type: "reply", message: messageText } satisfies Route;
		}
		const proposal = await proposeCreateTopic(runner, messageText, context);
		if (!proposal) {
			await runner.recordRoutingStep(
				"route",
				{ message: messageText },
				{ type: "reply" },
			);
			return { type: "reply", message: messageText } satisfies Route;
		}
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "proposal", kind: proposal.proposal.kind },
		);
		return proposal;
	}

	const obvious = deduceObviousIntent(messageText, context);
	if (obvious) {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "command", intent: obvious },
		);
		return { type: "command", intent: obvious } satisfies Route;
	}

	// Natural-language "what's next?" → propose advancing within the current plan.
	// Do not auto-apply (that only happens for explicit /update).
	if (looksLikeNextWithinTopic(messageText)) {
		return proposeTopicUpdate(runner, messageText, context);
	}

	let inferred = await inferFromRaw(messageText, context, runner);

	// With an active topic, never invent a brand-new subject from chat.
	// Explicit /new is handled earlier via parseExplicitCommand.
	if (inferred.type === "new-topic" && context.topic) {
		inferred = { type: "update-topic", message: messageText };
	}

	if (inferred.type === "chat") {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "reply" },
		);
		return { type: "reply", message: messageText } satisfies Route;
	}

	if (inferred.type === "update-topic") {
		return proposeTopicUpdate(runner, messageText, context);
	}

	if (inferred.type === "new-question") {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "command", intent: inferred },
		);
		return { type: "command", intent: inferred } satisfies Route;
	}

	const lastQuestion = lastPracticeQuestion(context.recentMessages);
	if (lastQuestion) {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "command", intent: inferred },
		);
		return { type: "command", intent: inferred } satisfies Route;
	}

	const identifiedRaw = await runner.llmCall({
		name: "identify_question",
		instructions: [
			"Identify the question or problem the user is trying to answer.",
			'Respond in JSON: {"found": boolean, "question": string, "candidates": string[]}',
		].join("\n"),
		input: messageText,
	});
	const identified = parseJsonFromLlm(
		QuestionIdentificationSchema,
		identifiedRaw,
	);
	if (!identified || !identified.found) {
		return { type: "reply", message: messageText } satisfies Route;
	}

	await runner.recordRoutingStep(
		"route",
		{ message: messageText },
		{ type: "command", intent: inferred },
	);
	return { type: "command", intent: inferred } satisfies Route;
}

async function proposeCreateTopic(
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	messageText: string,
	context: AgentContext,
) {
	// Soft chat must never spawn a new subject while one is active.
	// Explicit /new goes through the command path, not this helper.
	if (context.topic) {
		return null;
	}

	const generated = await runner.llmCall({
		name: "generate_topic",
		instructions: [
			"Generate a learning topic from the user's request.",
			`Respond in JSON: {"title": string, "summary": string, "part": string}. ${TOPIC_PART_RULE}`,
		].join("\n"),
		input: messageText || "General learning",
	});
	const topicMeta = parseJsonFromLlm(TopicGenerationSchema, generated);
	if (!topicMeta) {
		return null;
	}
	return {
		type: "proposal" as const,
		prompt: `Start learning "${topicMeta.title}"?`,
		proposal: {
			kind: "create-topic" as const,
			title: topicMeta.title,
			summary: topicMeta.summary,
			part: shortFocus(topicMeta.part),
		},
	};
}

function buildUpdateInstructions(context: AgentContext) {
	if (!context.topic) {
		return "The student has no current topic.";
	}
	return [
		`Topic: ${context.topic.title}`,
		`Summary: ${context.topic.summary}`,
		context.topic.part ? `Current focus: ${context.topic.part}` : "",
		"When the user asks what is next, advance part to the next item in the summary outline and keep the same title/summary.",
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

async function proposeTopicUpdate(
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	messageText: string,
	context: AgentContext,
) {
	const generated = await runner.llmCall({
		name: "propose_update",
		instructions: [
			buildUpdateInstructions(context),
			"",
			"The user may want to change their learning plan or advance to the next section.",
			"If they ask what is next, set shouldUpdate true, keep the same title and summary, and set part to the next section in the summary outline after the current focus.",
			"Do not invent a different subject.",
			`Respond in JSON: {"shouldUpdate": boolean, "title": string, "summary": string, "part": string, "explanation": string}. ${TOPIC_PART_RULE}`,
			"If shouldUpdate is false, explain why no update is needed.",
		].join("\n"),
		input: messageText,
	});
	const parsed = parseJsonFromLlm(ProposedUpdateSchema, generated);
	if (!parsed || !parsed.shouldUpdate) {
		await runner.recordRoutingStep(
			"route",
			{ message: messageText },
			{ type: "reply" },
		);
		return { type: "reply", message: messageText } satisfies Route;
	}
	// Never let an "update" swap the whole subject under you.
	const title = context.topic?.title ?? parsed.title;
	const summary = context.topic?.summary ?? parsed.summary;
	const prompt =
		parsed.explanation ?? `Focus next on ${shortFocus(parsed.part)}?`;
	await runner.recordRoutingStep(
		"route",
		{ message: messageText },
		{ type: "proposal", kind: "update-topic" },
	);
	return {
		type: "proposal",
		prompt,
		proposal: {
			kind: "update-topic" as const,
			title,
			summary,
			part: shortFocus(parsed.part),
			explanation: parsed.explanation,
		},
	} satisfies Route;
}

async function fulfillRoute(
	db: Db,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	context: AgentContext,
	io: ChatRunIo,
	request: ChatRequest,
	route: Route,
) {
	if (route.type === "command") {
		return executeCommand(db, runner, context, io, request, route.intent);
	}
	if (route.type === "reply") {
		runner.announce("Writing a response");
		const { parts } = await executeExplanation(
			runner,
			context,
			route.message,
			(text) => {
				io.onDelta(0, text);
			},
		);
		return {
			parts,
			topicId: context.topic?.id,
			pendingProposal: null,
		};
	}

	emitVisible(io, route.prompt);
	const proposalId = `prop_${nanoid()}`;
	const pendingProposal: StoredProposal = {
		proposalId,
		prompt: route.prompt,
		proposal: route.proposal,
	};
	return {
		parts: [
			textPart(route.prompt),
			proposalPart(proposalId, route.prompt, route.proposal),
		],
		topicId: context.topic?.id,
		pendingProposal,
	};
}

async function executeCommand(
	db: Db,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	context: AgentContext,
	io: ChatRunIo,
	request: ChatRequest,
	intent: DeducedIntent,
) {
	switch (intent.type) {
		case "new-topic":
			return executeCreateTopicCommand(
				db,
				runner,
				context,
				io,
				request,
				intent.message,
			);
		case "update-topic": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			runner.announce("Updating your plan");
			const update = await generateTopicUpdate(
				runner,
				context,
				intent.message,
			);
			if (!update) {
				return {
					parts: [
						textPart(
							"I couldn't parse that plan update. Try /update again.",
						),
					],
					topicId: context.topic.id,
					pendingProposal: null,
				};
			}
			const applied = await applyTopicUpdate(
				db,
				context,
				context.topic.id,
				update,
			);
			emitVisible(io, "Learning plan updated!");
			return {
				parts: applied.parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		case "new-question": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const { parts } = await executeNewQuestion(
				runner,
				context,
				intent.message,
				(text) => {
				io.onDelta(0, text);
			},
			);
			return {
				parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		case "answer": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const lastQuestion = lastPracticeQuestion(context.recentMessages);
			const { parts } = await executeAnswer(
				runner,
				context,
				intent.message,
				(text) => {
					io.onDelta(0, text);
				},
				lastQuestion ?? undefined,
			);
			return {
				parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		case "chat": {
			runner.announce("Writing a response");
			const { parts } = await executeExplanation(
				runner,
				context,
				intent.message,
				(text) => {
				io.onDelta(0, text);
			},
			);
			return {
				parts,
				topicId: context.topic?.id,
				pendingProposal: null,
			};
		}
		default: {
			const _exhaustive: never = intent.type;
			return _exhaustive;
		}
	}
}

async function executeCreateTopicCommand(
	db: Db,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	context: AgentContext,
	io: ChatRunIo,
	request: ChatRequest,
	message: string,
) {
	runner.announce("Drafting a topic");
	const generated = await runner.llmCall({
		name: "generate_topic",
		instructions: [
			"Generate a learning topic from the user's request.",
			`Respond in JSON: {"title": string, "summary": string, "part": string}. ${TOPIC_PART_RULE}`,
		].join("\n"),
		input: message || "General learning",
	});
	const topicMeta = parseJsonFromLlm(TopicGenerationSchema, generated);
	if (!topicMeta) {
		return {
			parts: [
				textPart(
					"I couldn't create that topic. Try /new with a clearer subject.",
				),
			],
			topicId: context.topic?.id,
			pendingProposal: null,
		};
	}

	const part = shortFocus(topicMeta.part);
	const topic = await createTopic(db, {
		userId: context.userId,
		title: topicMeta.title,
		summary: topicMeta.summary,
		part,
	});
	await setCurrentTopic(db, context.userId, topic.id, part);

	// /new must own the triggering user turn on the new topic, not the old one.
	if (context.topic) {
		await reassignTopicMessage(db, request.message, topic.id);
	} else {
		await createTopicMessage(db, {
			id: request.message,
			topicId: topic.id,
			role: "user",
			parts: request.parts,
		});
		await linkAssetsToMessage(db, {
			userId: context.userId,
			messageId: request.message,
			parts: request.parts,
		});
	}

	const nextContext = {
		...context,
		topic: {
			id: topic.id,
			title: topicMeta.title,
			summary: topicMeta.summary,
			part,
		},
		recentMessages: [],
	};
	runner.announce("Drafting a plan");
	const { parts } = await executeNewTopicContinuation(
		runner,
		nextContext,
		topicMeta,
		(text) => {
			io.onDelta(0, text);
		},
	);
	return {
		parts,
		topicId: topic.id,
		pendingProposal: null,
	};
}

async function acceptProposal(
	db: Db,
	runner: Awaited<ReturnType<typeof createAgentRun>>,
	context: AgentContext,
	io: ChatRunIo,
	proposal: Proposal,
) {
	switch (proposal.kind) {
		case "create-topic": {
			const part = shortFocus(proposal.part);
			const topic = await createTopic(db, {
				userId: context.userId,
				title: proposal.title,
				summary: proposal.summary,
				part,
			});
			await setCurrentTopic(
				db,
				context.userId,
				topic.id,
				part,
			);
			if (!context.topic) {
				await createTopicMessage(db, {
					id: io.userMessageId,
					topicId: topic.id,
					role: "user",
					parts: [textPart("Yes")],
				});
			}
			const nextContext = {
				...context,
				topic: {
					id: topic.id,
					title: proposal.title,
					summary: proposal.summary,
					part,
				},
				recentMessages: [],
			};
			runner.announce("Drafting a plan");
			const { parts } = await executeNewTopicContinuation(
				runner,
				nextContext,
				proposal,
				(text) => {
					io.onDelta(0, text);
				},
			);
			return {
				parts,
				topicId: topic.id,
				pendingProposal: null,
			};
		}
		case "update-topic": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const applied = await applyTopicUpdate(
				db,
				context,
				context.topic.id,
				{
					title: proposal.title,
					summary: proposal.summary,
					part: proposal.part,
				},
			);
			emitVisible(io, "Learning plan updated!");
			return {
				parts: applied.parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		case "new-question": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const { parts } = await executeNewQuestion(
				runner,
				context,
				proposal.message,
				(text) => {
				io.onDelta(0, text);
			},
			);
			return {
				parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		case "grade-answer": {
			if (!context.topic) {
				return {
					parts: [textPart("Start a topic with /new first.")],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const { parts } = await executeAnswer(
				runner,
				context,
				proposal.solution,
				(text) => {
				io.onDelta(0, text);
			},
				proposal.question,
			);
			return {
				parts,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		default: {
			const _exhaustive: never = proposal;
			return _exhaustive;
		}
	}
}
