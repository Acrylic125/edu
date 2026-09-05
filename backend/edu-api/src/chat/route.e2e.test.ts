import type { ChatCompletionMessage } from 'openai/resources/chat/completions';
function response(input: Pick<ChatCompletionMessage, 'content' | 'tool_calls'>) {
	return { role: 'assistant' as const, refusal: null, ...input };
}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client';
import type { AgentContext } from './context';
import { MAX_TUTOR_TURNS } from '../agents/tool-loop';

const mocks = vi.hoisted(() => ({
	createAgentRun: vi.fn(),
	loadChatContext: vi.fn(),
	captureConversationMemory: vi.fn(),
	createTopic: vi.fn(),
	setCurrentTopic: vi.fn(),
	createTopicMessage: vi.fn(),
	reassignTopicMessage: vi.fn(),
	linkAssetsToMessage: vi.fn(),
	listRecentConversationMemories: vi.fn(),
	loadConversationExchanges: vi.fn(),
}));
vi.mock('../agents/runner', () => ({ createAgentRun: mocks.createAgentRun }));
vi.mock('./context', async (original) => ({ ...(await original<typeof import('./context')>()), loadChatContext: mocks.loadChatContext }));
vi.mock('../memory/service', async (original) => ({
	...(await original<typeof import('../memory/service')>()),
	captureConversationMemory: mocks.captureConversationMemory,
}));
vi.mock('../topics/repository', () => ({ createTopic: mocks.createTopic, setCurrentTopic: mocks.setCurrentTopic }));
vi.mock('../messages/persistence', () => ({
	createTopicMessage: mocks.createTopicMessage,
	reassignTopicMessage: mocks.reassignTopicMessage,
}));
vi.mock('../assets/repository', () => ({ linkAssetsToMessage: mocks.linkAssetsToMessage }));
vi.mock('../memory/repository', () => ({
	listRecentConversationMemories: mocks.listRecentConversationMemories,
	loadConversationExchanges: mocks.loadConversationExchanges,
}));
import { handleChat, handleDecision } from './route';

function setup(
	responses: ChatCompletionMessage[],
	topic: AgentContext['topic'] = { id: 'topic_1', title: 'Vectors', summary: 'Vector arithmetic', part: 'Addition' },
) {
	const context: AgentContext = { userId: 'user_1', topic, recentMessages: [], currentMessage: 'Explain vectors' };
	mocks.loadChatContext.mockImplementation(async (_db, _user, text: string) => ({ ...context, currentMessage: text }));
	const runner = {
		announce: vi.fn(),
		complete: vi.fn(),
		fail: vi.fn(),
		recordStep: vi.fn(),
		llmCall: vi.fn().mockResolvedValue('{"correct":true,"partiallyCorrect":false,"feedback":"Correct","errors":[]}'),
		withTrace: (fn: () => Promise<object>) => fn(),
		toolTurn: vi.fn(async (params: { messages: object[]; onDelta: (text: string) => void }) => {
			const next = responses.shift() ?? response({ content: 'Done.' });
			if (typeof next.content === 'string') params.onDelta(next.content);
			return next;
		}),
	};
	mocks.createAgentRun.mockResolvedValue(runner);
	const controller = new AbortController();
	const io = {
		signal: controller.signal,
		runId: 'run_1',
		assistantMessageId: 'msg_a',
		userMessageId: 'msg_u',
		onDelta: vi.fn(),
		onProgress: vi.fn(),
	};
	const send = (content = 'Explain vectors') =>
		handleChat({} as Db, { OPENROUTER_API_KEY: 'test' }, 'user_1', { messageId: 'msg_u', parts: [{ type: 'text', content }] }, io);
	return { runner, send, controller, io };
}
function call(name: string, args: object) {
	return response({ content: '', tool_calls: [{ id: 'call_1', function: { name, arguments: JSON.stringify(args) }, type: 'function' }] });
}
const plan = {
	title: 'Vectors',
	summary: 'Vector arithmetic',
	part: 'Addition',
	chapters: [
		{ chapter: 'Basics', whatIsCovered: 'Notation' },
		{ chapter: 'Addition', whatIsCovered: 'Add vectors' },
		{ chapter: 'Products', whatIsCovered: 'Dot products' },
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createTopic.mockResolvedValue({ id: 'topic_new' });
});
describe('Tutor orchestration with real tool dispatch', () => {
	it('answers directly with one model turn and no mandatory retrieval', async () => {
		const { send, runner, io } = setup([response({ content: 'A vector has magnitude and direction.' })]);
		const result = await send();
		expect(result.parts).toEqual([{ type: 'text', content: 'A vector has magnitude and direction.' }]);
		expect(runner.toolTurn).toHaveBeenCalledOnce();
		expect(runner.llmCall).not.toHaveBeenCalled();
		expect(mocks.listRecentConversationMemories).not.toHaveBeenCalled();
		expect(io.onDelta).toHaveBeenCalledWith(0, 'A vector has magnitude and direction.');
	});
	it('loads a skill, verifies an answer, and feeds both tool results back to the Tutor', async () => {
		const { send, runner } = setup([
			call('load_skill', { name: 'assess' }),
			call('verify_answer', { question: '1+1?', solution: '2' }),
			response({ content: 'Correct: 1 + 1 = 2.' }),
		]);
		await send('/ans 2');
		expect(runner.llmCall).toHaveBeenCalledWith(expect.objectContaining({ name: 'verify_solution' }));
		expect(runner.recordStep).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool', name: 'verify_answer' }));
		expect(runner.toolTurn.mock.calls.at(-1)?.[0].messages).toHaveLength(6);
	});
	it('validates model arguments before executing a mutation', async () => {
		const { send } = setup([call('create_topic', { ...plan, chapters: [] }), response({ content: 'Please clarify the plan.' })], null);
		await send('/new vectors');
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('proposes natural-language plan creation without mutating the DB', async () => {
		const { send } = setup([call('create_topic', plan)], null);
		const result = await send('I want to learn vectors');
		expect(result.pendingProposal).toMatchObject({ topicId: null, proposal: { kind: 'create-topic' }, request: { messageId: 'msg_u' } });
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('preserves the triggering text when /new creates the first topic', async () => {
		const { send } = setup([call('create_topic', plan)], null);
		expect((await send('/new vectors')).topicId).toBe('topic_new');
		expect(mocks.createTopicMessage).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 'msg_u', parts: [{ type: 'text', content: '/new vectors' }] }),
		);
	});
	it('does not let the model switch an active subject without /new', async () => {
		const { send } = setup([call('create_topic', plan), response({ content: 'Use /new to change subjects.' })]);
		await send();
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('rejects a proposal after switching topics', async () => {
		const { io } = setup([]);
		await expect(
			handleDecision(
				{} as Db,
				{ OPENROUTER_API_KEY: 'test' },
				'user_1',
				{
					proposalId: 'p1',
					topicId: 'another_topic',
					prompt: 'Change?',
					proposal: { kind: 'update-topic', part: 'Products' },
					request: { messageId: 'msg_u', parts: [{ type: 'text', content: 'next' }] },
				},
				'accept',
				io,
			),
		).rejects.toThrow('different topic');
		expect(mocks.createTopicMessage).not.toHaveBeenCalled();
	});
	it('bounds tool loops and does not fabricate a successful response', async () => {
		const { send, runner } = setup(Array.from({ length: MAX_TUTOR_TURNS }, () => call('load_skill', { name: 'explain' })));
		await expect(send()).rejects.toThrow('budget exhausted');
		expect(runner.fail).toHaveBeenCalledOnce();
		expect(runner.complete).not.toHaveBeenCalled();
	});
	it('does not execute a tool when cancellation arrives with the model response', async () => {
		const { send, runner, controller } = setup([]);
		runner.toolTurn.mockImplementationOnce(async () => {
			controller.abort();
			return call('create_topic', plan);
		});
		await expect(send('/new vectors')).rejects.toThrow();
		expect(mocks.createTopic).not.toHaveBeenCalled();
		expect(runner.complete).toHaveBeenCalledWith('cancelled');
	});
});
