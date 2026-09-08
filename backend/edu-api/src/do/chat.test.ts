import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WsServerMessageSchema } from '../messages/schema';

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			public ctx: DurableObjectState,
			public env: Env,
		) {}
	},
}));
const mocks = vi.hoisted(() => ({ handleChat: vi.fn(), handleDecision: vi.fn(), getCurrentTopic: vi.fn(), createTopicMessage: vi.fn(), reserve: vi.fn(), settle: vi.fn() }));
vi.mock('../billing/account', () => ({ getUserPlan: async () => 'free' }));
vi.mock('../billing/quota', () => ({ QuotaStore: class { reserve = mocks.reserve; settle = mocks.settle; } }));
vi.mock('../../db/client', () => ({ createDb: () => ({}) }));
vi.mock('../chat/route', () => ({ handleChat: mocks.handleChat, handleDecision: mocks.handleDecision }));
vi.mock('../topics/repository', () => ({ getCurrentTopic: mocks.getCurrentTopic, getTopicForUser: vi.fn(), setCurrentTopic: vi.fn() }));
vi.mock('../messages/persistence', () => ({ createTopicMessage: mocks.createTopicMessage }));
vi.mock('../assets/load', () => ({ loadAttachedImages: async () => [], loadOwnedImagesByIds: async () => [] }));
vi.mock('../assets/repository', () => ({ attachmentRefs: () => [], listOwnedAssetsByIds: async () => [], linkAssetsToMessage: vi.fn() }));
import { ChatDurableObject } from './chat';
import type { ChatRunIo } from '../chat/route';

function setup() {
	const records = new Map<string, object>();
	const sent: ReturnType<typeof WsServerMessageSchema.parse>[] = [];
	const pending: Promise<void>[] = [];
	const socket = {
		send: (text: string) => sent.push(WsServerMessageSchema.parse(JSON.parse(text))),
		deserializeAttachment: () => ({ userId: 'u1', expiresAt: Date.now() + 60000 }),
		close: vi.fn(),
	} as Partial<WebSocket> as WebSocket;
	const ctx = {
		storage: {
			get: async (key: string) => records.get(key),
			put: async (key: string, value: object) => {
				records.set(key, value);
			},
			delete: async (key: string) => records.delete(key),
		},
		getWebSockets: () => [socket],
		waitUntil: (task: Promise<void>) => {
			pending.push(task);
		},
	} as Partial<DurableObjectState> as DurableObjectState;
	return { object: new ChatDurableObject(ctx, {} as Env), socket, records, sent, pending };
}
const frame = (id: string) => JSON.stringify({ type: 'message', messageId: id, parts: [{ type: 'text', content: 'Explain' }] });
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getCurrentTopic.mockResolvedValue(null);
	mocks.reserve.mockResolvedValue({ ok: true, duplicate: false });
	mocks.settle.mockResolvedValue(undefined);
});

describe('Durable Object run lifecycle', () => {
	it('allows deterministic confirmations without AI allowance', async () => {
		mocks.reserve.mockResolvedValue({ ok: false, error: { code: 'limit_exceeded' } });
		mocks.handleDecision.mockResolvedValue({ parts: [], pendingProposal: null });
		const { object, socket, records, pending } = setup();
		records.set('pendingProposal', {
			proposalId: 'p1', topicId: null, prompt: 'Confirm?',
			request: { messageId: 'm0', parts: [{ type: 'text', content: 'Create a topic' }] },
			proposal: { kind: 'create-topic', title: 'Math', summary: 'Learn math', part: 'Algebra' },
		});
		await object.webSocketMessage(socket, JSON.stringify({ type: 'decision', proposalId: 'p1', decision: 'accept' }));
		await Promise.all(pending);
		expect(mocks.reserve).not.toHaveBeenCalled();
		expect(mocks.handleDecision).toHaveBeenCalledOnce();
	});
	it('refunds a provider failure before useful output', async () => {
		mocks.handleChat.mockRejectedValueOnce(new Error('Provider unavailable'));
		const { object, socket, pending } = setup();
		await object.webSocketMessage(socket, frame('m1'));
		await Promise.all(pending);
		expect(mocks.settle).toHaveBeenCalledWith('message:m1', true);
	});
	it('rejects exhausted allowance before persisting a message or starting AI', async () => {
		mocks.reserve.mockResolvedValueOnce({ ok: false, error: { code: 'limit_exceeded', message: 'Daily limit', retryAfter: 60 } });
		const { object, socket, sent, records } = setup();
		await object.webSocketMessage(socket, frame('m1'));
		expect(sent.at(-1)).toMatchObject({ type: 'error', code: 'limit_exceeded', requestId: 'm1' });
		expect(mocks.createTopicMessage).not.toHaveBeenCalled();
		expect(mocks.handleChat).not.toHaveBeenCalled();
		expect(records.has('activeRun')).toBe(false);
	});
	it('does not execute a replayed admission', async () => {
		mocks.reserve.mockResolvedValueOnce({ ok: true, duplicate: true });
		const { object, socket, sent } = setup();
		await object.webSocketMessage(socket, frame('m1'));
		expect(sent.at(-1)).toMatchObject({ code: 'already_submitted' });
		expect(mocks.handleChat).not.toHaveBeenCalled();
	});
	it('reserves submissions before asynchronous topic reads', async () => {
		let release = () => {};
		mocks.getCurrentTopic.mockImplementationOnce(
			() =>
				new Promise<null>((resolve) => {
					release = () => resolve(null);
				}),
		);
		mocks.handleChat.mockResolvedValue({ parts: [], pendingProposal: null });
		const { object, socket, pending, sent } = setup();
		const first = object.webSocketMessage(socket, frame('m1'));
		await vi.waitFor(() => expect(mocks.getCurrentTopic).toHaveBeenCalledOnce());
		await object.webSocketMessage(socket, frame('m2'));
		expect(sent).toContainEqual(expect.objectContaining({ type: 'error', message: 'Tutor is already running' }));
		release();
		await first;
		await Promise.all(pending);
		expect(mocks.handleChat).toHaveBeenCalledOnce();
	});
	it('holds the run lease after stop until execution settles', async () => {
		let rejectRun = () => {};
		mocks.handleChat.mockImplementation(
			(_db, _env, _user, _frame, io: ChatRunIo) =>
				new Promise((_, reject) => {
					rejectRun = () => reject(io.signal.reason);
				}),
		);
		const { object, socket, pending, records, sent } = setup();
		await object.webSocketMessage(socket, frame('m1'));
		await vi.waitFor(() => expect(mocks.handleChat).toHaveBeenCalledOnce());
		const started = sent.find((message) => message.type === 'run.started');
		if (started?.type !== 'run.started') throw new Error('Missing start event');
		await object.webSocketMessage(socket, JSON.stringify({ type: 'stop', runId: started.runId }));
		expect(records.has('activeRun')).toBe(true);
		await object.webSocketMessage(socket, frame('m2'));
		expect(mocks.handleChat).toHaveBeenCalledOnce();
		rejectRun();
		await Promise.all(pending);
		expect(records.has('activeRun')).toBe(false);
		expect(mocks.settle).toHaveBeenCalledWith('message:m1', false);
		expect(sent.filter((message) => message.type === 'run.ended')).toEqual([expect.objectContaining({ status: 'cancelled' })]);
	});
	it('reports persistence failures as failed, never completed', async () => {
		mocks.handleChat.mockResolvedValue({ parts: [{ type: 'text', content: 'hello' }], topicId: 'topic_1', pendingProposal: null });
		mocks.createTopicMessage.mockRejectedValueOnce(new Error('DB unavailable'));
		const { object, socket, pending, sent } = setup();
		await object.webSocketMessage(socket, frame('m1'));
		await Promise.all(pending);
		expect(sent.at(-1)).toMatchObject({ type: 'run.ended', status: 'failed' });
		expect(JSON.stringify(sent)).not.toContain('DB unavailable');
	});
	it('rejects oversized frames before decoding their JSON', async () => {
		const { object, socket } = setup();
		await object.webSocketMessage(socket, 'x'.repeat(65537));
		expect(socket.close).toHaveBeenCalledWith(1009, expect.any(String));
		expect(mocks.handleChat).not.toHaveBeenCalled();
	});
});
