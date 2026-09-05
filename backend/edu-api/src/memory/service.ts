import type { Db } from "../../db/client";
import type { AgentRunner } from "../agents/runner";
import { parseJsonFromLlm } from "../agents/parsed-output";
import { attachmentRefs } from "../assets/repository";
import type { AgentContext } from "../chat/context";
import { partsToText } from "../messages/parts";
import type { MessagePart } from "../messages/schema";
import {
	createConversationMemory,
	listRecentConversationMemories,
	loadConversationExchanges,
} from "./repository";
import {
	MemoryExpansionSchema,
	MemorySummarySchema,
	type RetrievedMemory,
} from "./schema";

const MAX_MEMORY_SUMMARIES = 6;
const MAX_FULL_EXCHANGES = 2;
const SEARCH_WINDOW = 100;

const STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"could",
	"from",
	"have",
	"into",
	"just",
	"please",
	"that",
	"their",
	"then",
	"there",
	"these",
	"they",
	"this",
	"what",
	"when",
	"where",
	"which",
	"with",
	"would",
	"your",
]);

function searchTerms(value: string) {
	return new Set(
		value
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu)
			?.filter((term) => term.length > 2 && !STOP_WORDS.has(term)) ?? [],
	);
}

export function rankConversationMemories(
	memories: RetrievedMemory[],
	query: string,
	topicId: string | null,
) {
	const queryTerms = searchTerms(query);
	return memories
		.map((memory, index) => {
			const memoryTerms = searchTerms(
				`${memory.summary} ${memory.keywords.join(" ")}`,
			);
			let overlap = 0;
			for (const term of queryTerms) {
				if (memoryTerms.has(term)) {
					overlap += 1;
				}
			}
			const sameTopic = topicId !== null && memory.topicId === topicId;
			const score = overlap * 3 + (sameTopic ? 2 : 0) + 1 / (index + 1);
			return { memory, overlap, sameTopic, score };
		})
		.filter((candidate) => candidate.overlap > 0 || candidate.sameTopic)
		.sort((left, right) => right.score - left.score)
		.slice(0, MAX_MEMORY_SUMMARIES)
		.map((candidate) => candidate.memory);
}

export async function enrichChatContextWithMemory(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
) {
	const recent = await listRecentConversationMemories(
		db,
		context.userId,
		SEARCH_WINDOW,
	);
	const summaries = rankConversationMemories(
		recent,
		context.currentMessage,
		context.topic?.id ?? null,
	);

	await runner.recordStep({
		type: "retrieval",
		name: "retrieve_memory_summaries",
		input: {
			query: context.currentMessage,
			topicId: context.topic?.id ?? null,
		},
		output: {
			memories: summaries.map((memory) => ({
				id: memory.id,
				summary: memory.summary,
				hasImages: memory.hasImages,
			})),
		},
	});

	if (summaries.length === 0) {
		await runner.recordStep({
			type: "retrieval",
			name: "retrieve_full_exchanges",
			input: { memoryIds: [] },
			output: { exchanges: [] },
		});
		return { ...context, memorySummaries: [], retrievedExchanges: [] };
	}

	const selectionRaw = await runner.llmCall({
		name: "select_full_exchanges",
		stepType: "retrieval",
		maxTokens: 256,
		instructions: [
			"Decide which earlier exchanges are needed to answer the current request accurately.",
			`Select at most ${MAX_FULL_EXCHANGES}. Prefer no full exchange when summaries are sufficient.`,
			'Respond in JSON: {"memoryIds": string[]}',
		].join("\n"),
		input: JSON.stringify({
			request: context.currentMessage,
			memories: summaries.map((memory) => ({
				id: memory.id,
				summary: memory.summary,
				hasImages: memory.hasImages,
			})),
		}),
	});
	const selection = parseJsonFromLlm(MemoryExpansionSchema, selectionRaw);
	const candidateIds = new Set(summaries.map((memory) => memory.id));
	const memoryIds = (selection?.memoryIds ?? [])
		.filter((id: string) => candidateIds.has(id))
		.slice(0, MAX_FULL_EXCHANGES);
	const exchanges = await loadConversationExchanges(
		db,
		context.userId,
		memoryIds,
	);

	await runner.recordStep({
		type: "tool",
		name: "retrieve_full_exchanges",
		input: { memoryIds },
		output: {
			exchanges: exchanges.map((exchange) => ({
				memoryId: exchange.memoryId,
				request: exchange.request,
				response: exchange.response,
			})),
		},
	});
	return {
		...context,
		memorySummaries: summaries,
		retrievedExchanges: exchanges,
	};
}

export async function captureConversationMemory(
	db: Db,
	runner: AgentRunner,
	params: {
		userId: string;
		topicId: string | null;
		userMessageId: string;
		agentMessageId: string;
		intent: string | null;
		requestParts: MessagePart[];
		responseParts: MessagePart[];
	},
) {
	const request = partsToText(params.requestParts);
	const response = partsToText(params.responseParts);
	if (request.trim() === "" || response.trim() === "") {
		return;
	}

	const summaryRaw = await runner.llmCall({
		name: "summarize_exchange",
		stepType: "memory",
		maxTokens: 256,
		currentImagesOnly: true,
		instructions: [
			"Summarize this user request and assistant response for future conversation retrieval.",
			"Capture the user's goal, important facts, decisions, misunderstandings, outcome, and unresolved follow-ups.",
			"Treat assistant claims as prior context, not verified facts.",
			"If images were attached, include the visually relevant information used in the response.",
			'Respond in JSON: {"summary": string, "keywords": string[]}',
		].join("\n"),
		input: JSON.stringify({ request, response }),
	});
	const parsed = parseJsonFromLlm(MemorySummarySchema, summaryRaw);
	if (!parsed) {
		return;
	}

	const memoryId = await createConversationMemory(db, {
		userId: params.userId,
		topicId: params.topicId,
		userMessageId: params.userMessageId,
		agentMessageId: params.agentMessageId,
		intent: params.intent,
		summary: parsed.summary,
		keywords: parsed.keywords,
		imageAssetIds: attachmentRefs(params.requestParts),
	});
	await runner.recordStep({
		type: "memory",
		name: "persist_exchange_memory",
		input: {
			userMessageId: params.userMessageId,
			agentMessageId: params.agentMessageId,
		},
		output: { memoryId },
	});
}
