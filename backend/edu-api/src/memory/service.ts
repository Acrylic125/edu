import type { Db } from '../../db/client';
import type { AgentRunner } from '../agents/runner';
import { parseJsonFromLlm } from '../agents/parsed-output';
import { attachmentRefs } from '../assets/repository';
import { partsToText } from '../messages/parts';
import type { MessagePart } from '../messages/schema';
import { createConversationMemory } from './repository';
import { MemorySummarySchema, type RetrievedMemory } from './schema';

const MAX_MEMORY_SUMMARIES = 6;

const STOP_WORDS = new Set([
	'about',
	'after',
	'again',
	'could',
	'from',
	'have',
	'into',
	'just',
	'please',
	'that',
	'their',
	'then',
	'there',
	'these',
	'they',
	'this',
	'what',
	'when',
	'where',
	'which',
	'with',
	'would',
	'your',
]);

function searchTerms(value: string) {
	return new Set(
		value
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu)
			?.filter((term) => term.length > 2 && !STOP_WORDS.has(term)) ?? [],
	);
}

export function rankConversationMemories(memories: RetrievedMemory[], query: string, topicId: string | null) {
	const queryTerms = searchTerms(query);
	return memories
		.map((memory, index) => {
			const memoryTerms = searchTerms(`${memory.summary} ${memory.keywords.join(' ')}`);
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
	if (request.trim() === '' || response.trim() === '') {
		return;
	}

	const summaryRaw = await runner.llmCall({
		name: 'summarize_exchange',
		stepType: 'memory',
		maxTokens: 256,
		currentImagesOnly: true,
		instructions: [
			'Summarize this user request and assistant response for future conversation retrieval.',
			"Capture the user's goal, important facts, decisions, misunderstandings, outcome, and unresolved follow-ups.",
			'Treat assistant claims as prior context, not verified facts.',
			'If images were attached, include the visually relevant information used in the response.',
			'Respond in JSON: {"summary": string, "keywords": string[]}',
		].join('\n'),
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
		type: 'memory',
		name: 'persist_exchange_memory',
		input: {
			userMessageId: params.userMessageId,
			agentMessageId: params.agentMessageId,
		},
		output: { memoryId },
	});
}
