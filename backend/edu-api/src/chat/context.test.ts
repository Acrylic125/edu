import { describe, expect, it } from 'vitest';

import { buildSystemContext, formatMessagesForModel, type AgentContext } from './context';
import type { PersistedTopicMessage } from '../messages/schema';

describe('buildSystemContext', () => {
	it('instructs the agent to use Mermaid for requested diagrams', () => {
		const context: AgentContext = {
			userId: 'user_1',
			topic: null,
			recentMessages: [],
			currentMessage: 'Show me a state-machine diagram',
		};

		const instructions = buildSystemContext(context);

		expect(instructions).toContain('```mermaid');
		expect(instructions).toContain('Do not use ASCII art');
		expect(instructions).toContain('Place the Mermaid diagram where it best supports the explanation');
	});

	it('omits previous Mermaid source from model history', () => {
		const message: PersistedTopicMessage = {
			id: 'message_1',
			topicId: 'topic_1',
			role: 'assistant',
			parts: [
				{
					type: 'text',
					content: 'Diagram:\n```mermaid\nflowchart LR\nA --> B\n```\nDone.',
				},
			],
			createdAt: new Date('2026-09-04T00:00:00Z'),
		};

		const history = formatMessagesForModel([message]);

		expect(history).toContain('[Previous Mermaid diagram omitted]');
		expect(history).not.toContain('A --> B');
	});

	it('includes retrieved summaries and selectively expanded exchanges', () => {
		const context: AgentContext = {
			userId: 'user_1',
			topic: null,
			recentMessages: [],
			currentMessage: 'Continue the eigenvalue example',
			memorySummaries: [
				{
					id: 'memory_1',
					topicId: 'topic_1',
					intent: 'chat',
					summary: 'The learner asked how to calculate eigenvalues.',
					keywords: ['eigenvalues'],
					createdAt: new Date('2026-09-04T00:00:00Z'),
					hasImages: true,
				},
			],
			retrievedExchanges: [
				{
					memoryId: 'memory_1',
					request: 'Show the calculation for matrix A.',
					response: 'Start with det(A - lambda I).',
					images: [
						{
							id: 'asset_1',
							filename: 'matrix.png',
							mimeType: 'image/png',
						},
					],
				},
			],
		};

		const instructions = buildSystemContext(context);

		expect(instructions).toContain('Retrieved conversation-memory index');
		expect(instructions).toContain('The learner asked how to calculate eigenvalues');
		expect(instructions).toContain('Show the calculation for matrix A');
		expect(instructions).toContain('matrix.png');
	});
});
