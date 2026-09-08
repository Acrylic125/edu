import type { Db } from '../../db/client';
import type { AgentImage } from '../assets/load';
import { createAgentRun } from '../agents/runner';
import type { LlmEnv } from '../agents/llm';
import { ChatRequestSchema, type MessagePart, type Proposal, type ChatRequest } from '../messages/schema';
import { createTopicMessage } from '../messages/persistence';
import { partsToText, textPart } from '../messages/parts';
import { captureConversationMemory } from '../memory/service';
import { loadChatContext, maybeScheduleSummaryUpdate } from './context';
import { acceptProposal } from './actions';
import { repairInvalidResponseMarkup } from './latex';
import { runTutor } from './tutor';

export type ChatRunIo = {
	env?: Env;
	documents?: Array<{ assetId: string; filename: string | null; status: string; pageCount: number | null; indexedPages: number }>;
	signal: AbortSignal;
	topicId?: string | null;
	runId: string;
	assistantMessageId: string;
	userMessageId: string;
	onDelta: (partIndex: number, text: string) => void;
	onProgress: (label: string) => void;
	defer?: (task: () => Promise<void>) => void;
	images?: AgentImage[];
	loadImagesByIds?: (assetIds: string[]) => Promise<AgentImage[]>;
};

export type StoredProposal = {
	request: ChatRequest;
	proposalId: string;
	topicId: string | null;
	topicUpdatedAt?: string | null;
	prompt: string;
	proposal: Proposal;
};

export type ChatTurnResult = {
	committed?: boolean;
	parts: MessagePart[];
	topicId?: string;
	pendingProposal: StoredProposal | null;
};

export async function handleChat(db: Db, llmEnv: LlmEnv, userId: string, body: object, io: ChatRunIo) {
	const request = ChatRequestSchema.parse(body);
	const context = await loadChatContext(db, userId, partsToText(request.parts), io.topicId);
	// The triggering message has already been persisted by the transport.
	context.recentMessages = context.recentMessages.filter((message) => message.id !== io.userMessageId);
	const runner = await createAgentRun(db, llmEnv, {
		userId,
		runId: io.runId,
		topicId: context.topic?.id ?? null,
		userMessageId: io.userMessageId,
		intent: 'tutor',
		signal: io.signal,
		onProgress: io.onProgress,
		images: io.images,
	});
	return runner.withTrace(partsToText(request.parts), async () => {
		try {
			runner.announce('Thinking');
			const result = await runTutor(db, runner, context, request, io);
			if (!result.committed) io.signal.throwIfAborted();
			const parts = await repairInvalidResponseMarkup(runner, result.parts);
			io.signal.throwIfAborted();
			await runner.complete();
			// Memory indexing is optional background work, not part of response latency.
			if (io.defer)
				io.defer(async () => {
					try {
						await captureConversationMemory(db, runner, {
							userId,
							topicId: result.topicId ?? null,
							userMessageId: io.userMessageId,
							agentMessageId: io.assistantMessageId,
							intent: 'tutor',
							requestParts: request.parts,
							responseParts: parts,
						});
						if (result.topicId) await maybeScheduleSummaryUpdate(db, runner, result.topicId, userId);
					} catch (error) {
						console.error('Conversation indexing failed', error);
					}
				});
			return { ...result, parts };
		} catch (error) {
			if (io.signal.aborted) await runner.complete('cancelled');
			else await runner.fail(error instanceof Error ? error : String(error));
			throw error;
		}
	});
}

export async function handleDecision(
	db: Db,
	llmEnv: LlmEnv,
	userId: string,
	stored: StoredProposal,
	decision: 'accept' | 'reject',
	io: ChatRunIo,
) {
	const context = await loadChatContext(db, userId, '', io.topicId);
	if ((context.topic?.id ?? null) !== stored.topicId) throw new Error('Proposal belongs to a different topic');
	if (
		decision === 'accept' &&
		stored.topicUpdatedAt &&
		context.topic?.updatedAt !== stored.topicUpdatedAt
	) {
		return {
			parts: [textPart('This plan changed after the proposal was created. Please request the update again.')],
			topicId: context.topic?.id,
			pendingProposal: null,
		};
	}
	if (context.topic)
		await createTopicMessage(db, {
			id: io.userMessageId,
			topicId: context.topic.id,
			role: 'user',
			parts: [textPart(decision === 'accept' ? 'Confirm' : 'Cancel')],
		});
	const runner = await createAgentRun(db, llmEnv, {
		userId,
		runId: io.runId,
		topicId: context.topic?.id ?? null,
		userMessageId: io.userMessageId,
		intent: stored.proposal.kind,
		signal: io.signal,
		onProgress: io.onProgress,
	});
	return runner.withTrace(decision === 'accept' ? 'Confirm' : 'Cancel', async () => {
		try {
			io.signal.throwIfAborted();
			let result: ChatTurnResult = { parts: [textPart("Okay, I won't do that.")], topicId: context.topic?.id, pendingProposal: null };
			if (decision === 'accept') result = await acceptProposal(db, runner, context, io, stored.proposal, stored.request);
			if (!result.committed) io.signal.throwIfAborted();
			await runner.complete();
			return result;
		} catch (error) {
			if (io.signal.aborted) await runner.complete('cancelled');
			else await runner.fail(error instanceof Error ? error : String(error));
			throw error;
		}
	});
}
