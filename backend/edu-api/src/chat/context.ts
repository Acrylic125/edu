import type { Db } from '../../db/client';
import type { PersistedTopicMessage } from '../messages/schema';
import { countTopicMessages, formatMessageForModel, loadRecentMessages } from '../messages/persistence';
import { getCurrentTopic, getTopicForUser } from '../topics/repository';
import type { AgentRunner } from '../agents/runner';
import type { RetrievedExchange, RetrievedMemory } from '../memory/schema';
import type { TopicPlanStep } from '../messages/schema';

export type AgentContext = {
	userId: string;
	topic: {
		id: string;
		title: string;
		summary: string;
		part: string | null;
		plan?: TopicPlanStep[];
		currentStepId?: string | null;
		updatedAt?: string;
	} | null;
	recentMessages: PersistedTopicMessage[];
	currentMessage: string;
	memorySummaries?: RetrievedMemory[];
	retrievedExchanges?: RetrievedExchange[];
};

export async function loadChatContext(db: Db, userId: string, currentMessage: string, topicId?: string | null) {
	let current = await getCurrentTopic(db, userId);
	if (topicId === null) current = null;
	else if (topicId && topicId !== current?.topic.id) {
		const topic = await getTopicForUser(db, topicId, userId);
		if (!topic) throw new Error('Topic not found');
		current = { topic, part: null, currentStepId: null };
	}

	if (!current) {
		return {
			userId,
			topic: null,
			recentMessages: [],
			currentMessage,
		};
	}

	const recentMessages = await loadRecentMessages(db, current.topic.id, 8);
	let currentStep = current.topic.plan?.find((step) => step.id === current.currentStepId);
	if (!currentStep && current.topic.plan && current.part) {
		const sectionNumber = /^\d+$/.exec(current.part)?.[0];
		if (sectionNumber) currentStep = current.topic.plan[Number(sectionNumber) - 1];
	}

	return {
		userId,
		topic: {
			id: current.topic.id,
			title: current.topic.title,
			summary: current.topic.summary,
			part: currentStep?.label ?? current.part,
			plan: current.topic.plan,
			currentStepId: current.currentStepId,
			updatedAt: current.topic.updatedAt.toISOString(),
		},
		recentMessages,
		currentMessage,
	};
}

export function formatMessagesForModel(messages: PersistedTopicMessage[]) {
	return messages
		.map((message) => {
			return formatMessageForModel(message).replace(/```mermaid\b[\s\S]*?(?:```|$)/gi, '[Previous Mermaid diagram omitted]');
		})
		.join('\n\n');
}

export function buildSystemContext(context: AgentContext) {
	const sections: string[] = [
		'You are an educational assistant helping a student learn.',
		[
			'When the student asks for a diagram, visualization, state machine, flowchart, graph, or process map, include a valid Mermaid diagram in a fenced ```mermaid code block.',
			'Place the Mermaid diagram where it best supports the explanation. Always complete the diagram and close its code fence, and keep the entire response concise.',
			'Do not use ASCII art for diagrams, repeat the transition table in prose, or explain every edge unless asked. Keep Mermaid node identifiers simple and put human-readable labels in quotes.',
		].join(' '),
	];

	if (context.topic) {
		sections.push(`Topic: ${context.topic.title}`);
		sections.push(`Summary: ${context.topic.summary}`);
		if (context.topic.part) {
			sections.push(`Current focus: ${context.topic.part}`);
		}
		if (context.topic.plan && context.topic.plan.length > 0) {
			sections.push(`Plan: ${JSON.stringify(context.topic.plan)}`);
			sections.push(`Current step id: ${context.topic.currentStepId ?? 'none'}`);
		}
	}

	if (context.recentMessages.length > 0) {
		sections.push('Recent conversation:');
		sections.push(formatMessagesForModel(context.recentMessages));
	}

	if (context.memorySummaries && context.memorySummaries.length > 0) {
		sections.push('Retrieved conversation-memory index:');
		sections.push(context.memorySummaries.map((memory) => `- [${memory.id}] ${memory.summary}`).join('\n'));
	}

	if (context.retrievedExchanges && context.retrievedExchanges.length > 0) {
		sections.push('Selected earlier exchanges:');
		sections.push(
			context.retrievedExchanges
				.map((exchange) => {
					const imageNote =
						exchange.images.length > 0 ? `\nAttached images: ${exchange.images.map((image) => image.filename ?? image.id).join(', ')}` : '';
					return [`Memory ${exchange.memoryId}`, `user: ${exchange.request}`, `agent: ${exchange.response}${imageNote}`].join('\n');
				})
				.join('\n\n'),
		);
	}

	return sections.join('\n\n');
}

const SUMMARY_THRESHOLD = 20;

export async function maybeScheduleSummaryUpdate(db: Db, runner: AgentRunner, topicId: string, userId: string) {
	try {
		const count = await countTopicMessages(db, topicId);
		if (count < SUMMARY_THRESHOLD || count % SUMMARY_THRESHOLD !== 0) {
			return;
		}

		const { updateTopicSummary } = await import('../topics/summary');
		await updateTopicSummary(db, runner, topicId, userId);
	} catch (error) {
		console.error('Summary update failed (non-blocking):', error);
	}
}
