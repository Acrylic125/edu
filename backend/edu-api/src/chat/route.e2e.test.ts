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
	updateCurrentPart: vi.fn(),
	updateTopicState: vi.fn(),
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
vi.mock('../topics/repository', () => ({
	createTopic: mocks.createTopic,
	setCurrentTopic: mocks.setCurrentTopic,
	updateCurrentPart: mocks.updateCurrentPart,
	updateTopicState: mocks.updateTopicState,
}));
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
		toolTurn: vi.fn(async (params: { messages: object[]; tools: object[]; onDelta: (text: string) => void }) => {
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
	plan: [
		{ title: 'Basics', role: 'section', depth: 0 },
		{ title: 'Addition', role: 'section', depth: 0 },
		{ title: 'Products', role: 'section', depth: 0 },
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
		expect(result.parts).toContainEqual({ type: 'text', content: 'A vector has magnitude and direction.' });
		expect(result.parts).toContainEqual(expect.objectContaining({ type: 'options' }));
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
		const result = await send('/ans 2');
		expect(runner.llmCall).toHaveBeenCalledWith(expect.objectContaining({ name: 'verify_solution' }));
		expect(runner.recordStep).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool', name: 'verify_answer' }));
		expect(runner.toolTurn.mock.calls.at(-1)?.[0].messages).toHaveLength(6);
		expect(result.parts).toContainEqual({
			type: 'options',
			options: [
				{ label: 'Try another question' },
				{ label: 'Explain Addition' },
				{ label: 'Continue to next topic' },
			],
		});
	});
	it('validates model arguments before executing a mutation', async () => {
		const { send } = setup([call('create_topic', { ...plan, plan: [] }), response({ content: 'Please clarify the plan.' })], null);
		await expect(send('/new vectors')).rejects.toThrow('did not apply');
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('proposes natural-language plan creation without mutating the DB', async () => {
		const { send } = setup([call('create_topic', plan)], null);
		const result = await send('I want to learn vectors');
		expect(result.pendingProposal).toMatchObject({ topicId: null, proposal: { kind: 'create-topic' }, request: { messageId: 'msg_u' } });
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('preserves the triggering text when /new creates the first topic', async () => {
		const { send, runner } = setup([call('create_topic', plan)], null);
		expect((await send('/new vectors')).topicId).toBe('topic_new');
		expect(runner.toolTurn).toHaveBeenCalledWith(
			expect.objectContaining({ toolChoice: { type: 'function', function: { name: 'create_topic' } } }),
		);
		expect(mocks.createTopicMessage).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 'msg_u', parts: [{ type: 'text', content: '/new vectors' }] }),
		);
	});
	it('uses the first plan step when the proposed focus is only a course label', async () => {
		const coursePlan = {
			title: 'CS2100: Data Representation and Number Systems',
			summary: 'Computer representation of numbers and text',
			part: 'CS2100',
			plan: [
				{ id: 'data-representation', label: 'Data Representation', summary: 'How computers encode data', parent: null },
				{ id: 'number-systems', label: 'Number Systems', summary: 'Binary, octal, and hexadecimal', parent: null },
				{ id: 'ascii', label: 'ASCII Code', summary: 'Representing characters as numbers', parent: null },
			],
		};
		const { send } = setup([call('create_topic', coursePlan)], null);
		const result = await send('/new CS2100\n\nLecture #3: Data Representation and Number Systems');
		expect(mocks.createTopic).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ part: 'Data Representation' }),
		);
		expect(mocks.setCurrentTopic).toHaveBeenCalledWith(
			expect.anything(),
			'user_1',
			'topic_new',
			'Data Representation',
			'data-representation',
		);
		expect(result.parts).toContainEqual({
			type: 'options',
			options: [{ label: 'Explain Data Representation' }, { label: 'Practice Data Representation' }],
		});
	});
	it('does not let an explicit creation command finish without creating the topic', async () => {
		const { send, io } = setup([response({ content: 'Your topic is ready.' })], null);
		await expect(send('/new vectors')).rejects.toThrow('did not apply');
		expect(mocks.createTopic).not.toHaveBeenCalled();
		expect(io.onDelta).not.toHaveBeenCalled();
	});
	it('creates a classified explicit outline in one model turn', async () => {
		const explicit = {
			title: 'CS2100: Data Representation and Number Systems',
			summary: 'Data representation',
			part: 'Data Representation',
			plan: [
				{ sourceIndex: 0, title: 'CS2100', role: 'context' },
				{
					sourceIndex: 1,
					title: 'Lecture #3: Data Representation and Number Systems',
					role: 'header',
				},
				{
					sourceIndex: 2,
					title: 'Data Representation',
					role: 'section',
					depth: 0,
				},
				{
					sourceIndex: 3,
					title: 'Repeated Division-by-2',
					role: 'section',
					depth: 1,
				},
				{
					sourceIndex: 4,
					title: 'ASCII Code',
					role: 'section',
					depth: 0,
				},
			],
		};
		const { send, runner } = setup([call('create_topic', explicit)], null);
		const result = await send(`/new CS2100

Lecture #3: Data Representation and Number Systems
Data Representation
5.1 Repeated Division-by-2
ASCII Code`);
		expect(runner.toolTurn).toHaveBeenCalledOnce();
		expect(runner.toolTurn.mock.calls[0]?.[0].tools).toHaveLength(1);
		expect(mocks.createTopic).toHaveBeenCalledOnce();
		expect(mocks.createTopic).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ title: 'CS2100: Data Representation and Number Systems', part: 'Data Representation' }),
		);
		const planText = result.parts.find((part) => part.type === 'text')?.content;
		expect(planText).toContain("I'll use the plan you provided:");
		expect(planText).toContain('### Lecture #3: Data Representation and Number Systems');
		expect(planText).toContain('- **Data Representation**');
		expect(planText).toContain('  - Repeated Division-by-2');
		expect(planText).toContain('- **ASCII Code**');
		expect(planText).not.toContain('| Section |');
		expect(planText).not.toContain('Representation overview');
		expect(result.parts).toContainEqual({
			type: 'options',
			options: [{ label: 'Explain Data Representation' }, { label: 'Practice Data Representation' }],
		});
	});
	it('does not let the model switch an active subject without /new', async () => {
		const { send } = setup([call('create_topic', plan), response({ content: 'Use /new to change subjects.' })]);
		await send();
		expect(mocks.createTopic).not.toHaveBeenCalled();
	});
	it('advances immediately when the learner explicitly asks for the next topic', async () => {
		const { send } = setup([call('update_topic', { part: 'ASCII representation' })]);
		const result = await send('Continue to next topic');
		expect(result.pendingProposal).toBeNull();
		expect(mocks.updateCurrentPart).toHaveBeenCalledWith(expect.anything(), 'user_1', 'ASCII representation', 'topic_1');
	});
	it('adds next-step options to a direct completed answer', async () => {
		const { send } = setup([response({ content: 'Correct. A is 65 and B is 66.' })]);
		const result = await send('65 66');
		expect(result.parts).toContainEqual({
			type: 'options',
			options: [
				{ label: 'Practice Addition' },
				{ label: 'Explain Addition' },
				{ label: 'Continue to next topic' },
			],
		});
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
