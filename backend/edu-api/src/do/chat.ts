import { DurableObject } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb } from '../../db/client';
import { agentRun } from '../../db/schema';
import { loadAttachedImages, loadOwnedImagesByIds } from '../assets/load';
import { MAX_MESSAGE_ASSETS } from '../assets/limits';
import { attachmentRefs, linkAssetsToMessage, listOwnedAssetsByIds } from '../assets/repository';
import { handleChat, handleDecision, type ChatTurnResult } from '../chat/route';
import { createTopicMessage } from '../messages/persistence';
import { persistableParts, textPart } from '../messages/parts';
import {
	ProposalSchema,
	ChatRequestSchema,
	WsClientEnvelopeSchema,
	MAX_WS_MESSAGE_BYTES,
	type WsClientEnvelope,
	type WsServerMessage,
} from '../messages/schema';
import { getCurrentTopic, getTopicForUser, setCurrentTopic } from '../topics/repository';

export const EDU_USER_ID_HEADER = 'X-Edu-User-Id';
export const EDU_SESSION_EXPIRES_HEADER = 'X-Edu-Session-Expires';
const ACTIVE_RUN_KEY = 'activeRun';
const PENDING_PROPOSAL_KEY = 'pendingProposal';
const WsAttachmentSchema = z.object({ userId: z.string(), expiresAt: z.number() });
const ActiveRunSchema = z.object({ runId: z.string(), messageId: z.string(), topicId: z.string().optional() });
const StoredProposalSchema = z.object({
	request: ChatRequestSchema,
	proposalId: z.string(),
	topicId: z.string().nullable(),
	prompt: z.string(),
	proposal: ProposalSchema,
});

export class ChatDurableObject extends DurableObject<Env> {
	private abort: AbortController | null = null;
	private submitting = false;
	private lastSubmitAt = 0;

	private broadcast(message: WsServerMessage) {
		for (const socket of this.ctx.getWebSockets()) this.sendJson(socket, message);
	}

	private sendJson(ws: WebSocket, message: WsServerMessage) {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			ws.close(1011, 'Connection closed');
		}
	}

	async fetch(request: Request) {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 });
		const userId = request.headers.get(EDU_USER_ID_HEADER);
		const expiresAt = Number(request.headers.get(EDU_SESSION_EXPIRES_HEADER));
		if (!userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return new Response('Unauthorized', { status: 401 });
		if (this.ctx.getWebSockets().length >= 5) return new Response('Too many connections', { status: 429 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ userId, expiresAt });
		await this.recoverOrphanedRun();
		this.sendJson(server, { type: 'ready', userId });
		const active = await this.readActiveRun();
		if (active) this.sendJson(server, { type: 'run.started', ...active });
		return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'edu-chat' } });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > MAX_WS_MESSAGE_BYTES) {
			ws.close(1009, 'Message too large or unsupported');
			return;
		}
		const attachment = WsAttachmentSchema.safeParse(ws.deserializeAttachment());
		if (!attachment.success || attachment.data.expiresAt <= Date.now()) {
			ws.close(1008, 'Session expired');
			return;
		}
		let frame: WsClientEnvelope;
		try {
			frame = WsClientEnvelopeSchema.parse(JSON.parse(message));
		} catch {
			this.sendJson(ws, { type: 'error', message: 'Invalid message' });
			return;
		}
		if (frame.type === 'stop') {
			const active = await this.readActiveRun();
			if (active?.runId === frame.runId) this.abort?.abort();
			// Keep the lease until execution settles; aborted work must not overlap a new run.
			return;
		}
		if (this.submitting || this.abort) {
			this.sendJson(ws, { type: 'error', message: 'Tutor is already running' });
			return;
		}
		if (Date.now() - this.lastSubmitAt < 1000) {
			this.sendJson(ws, { type: 'error', message: 'Please wait before sending again' });
			return;
		}
		// Acquire before the first await: Durable Object handlers can interleave at I/O.
		this.submitting = true;
		this.lastSubmitAt = Date.now();
		try {
			await this.recoverOrphanedRun();
			await this.submit(attachment.data.userId, frame);
		} catch (error) {
			console.error('Chat submission failed', error);
			this.sendJson(ws, { type: 'error', message: 'Could not submit that request. Check the topic and attachments, then retry.' });
		} finally {
			this.submitting = false;
		}
	}

	private async submit(userId: string, frame: Exclude<WsClientEnvelope, { type: 'stop' }>) {
		const db = createDb(this.env.DB);
		if (frame.type === 'message' && frame.topicId) {
			if (!(await getTopicForUser(db, frame.topicId, userId))) throw new Error('Topic not found');
			const previous = await getCurrentTopic(db, userId);
			let part: string | null = null;
			if (previous?.topic.id === frame.topicId) part = previous.part;
			await setCurrentTopic(db, userId, frame.topicId, part);
		}
		const current = await getCurrentTopic(db, userId);
		let stored: z.infer<typeof StoredProposalSchema> | null = null;
		let userMessageId = `msg_${nanoid()}`;
		if (frame.type === 'decision') {
			stored = await this.readPendingProposal();
			if (!stored || stored.proposalId !== frame.proposalId || stored.topicId !== (current?.topic.id ?? null))
				throw new Error('Stale proposal');
			await this.ctx.storage.delete(PENDING_PROPOSAL_KEY);
		} else {
			userMessageId = frame.messageId;
			const refs = attachmentRefs(frame.parts);
			if (refs.length > MAX_MESSAGE_ASSETS || new Set(refs).size !== refs.length) throw new Error('Invalid attachments');
			const owned = await listOwnedAssetsByIds(db, userId, refs);
			if (owned.length !== refs.length || owned.some((asset) => asset.topicMessageId !== null)) throw new Error('Attachment unavailable');
			if (current) {
				await createTopicMessage(db, { id: userMessageId, topicId: current.topic.id, role: 'user', parts: persistableParts(frame.parts) });
				await linkAssetsToMessage(db, { userId, messageId: userMessageId, parts: frame.parts });
			}
			await this.ctx.storage.delete(PENDING_PROPOSAL_KEY);
		}
		const active = { runId: `run_${nanoid()}`, messageId: `msg_${nanoid()}`, topicId: current?.topic.id };
		const abort = new AbortController();
		await this.ctx.storage.put(ACTIVE_RUN_KEY, active);
		this.abort = abort;
		this.broadcast({ type: 'run.started', ...active });
		this.ctx.waitUntil(
			this.execute(userId, userMessageId, active, frame, stored, AbortSignal.any([abort.signal, AbortSignal.timeout(120000)])),
		);
	}

	private async execute(
		userId: string,
		userMessageId: string,
		active: z.infer<typeof ActiveRunSchema>,
		frame: Exclude<WsClientEnvelope, { type: 'stop' }>,
		stored: z.infer<typeof StoredProposalSchema> | null,
		signal: AbortSignal,
	) {
		const db = createDb(this.env.DB);
		let accumulated = '';
		let result: ChatTurnResult = { parts: [], topicId: active.topicId, pendingProposal: null };
		let status: 'completed' | 'cancelled' | 'failed' = 'completed';
		const deferred: Array<() => Promise<void>> = [];
		const io = {
			signal,
			topicId: active.topicId ?? null,
			runId: active.runId,
			assistantMessageId: active.messageId,
			userMessageId,
			onDelta: (partIndex: number, text: string) => {
				if (signal.aborted) return;
				accumulated += text;
				this.broadcast({ type: 'run.delta', ...active, partIndex, text });
			},
			onProgress: (label: string) => {
				if (!signal.aborted) this.broadcast({ type: 'run.progress', ...active, label });
			},
			defer: (task: () => Promise<void>) => {
				deferred.push(task);
			},
			loadImagesByIds: (ids: string[]) => loadOwnedImagesByIds(this.env, db, userId, ids),
		};
		try {
			if (frame.type === 'message') {
				const images = await loadAttachedImages(this.env, db, userId, frame.parts);
				result = await handleChat(db, this.env, userId, frame, { ...io, images });
			} else if (stored) {
				result = await handleDecision(db, this.env, userId, stored, frame.decision, io);
			}
			if (!result.committed) signal.throwIfAborted();
		} catch (error) {
			if (signal.aborted) status = 'cancelled';
			else {
				status = 'failed';
				console.error('Tutor run failed', error);
			}
			let text = accumulated;
			if (status === 'failed') text += "\n\nI couldn't complete that request. Please try again.";
			result = { parts: text ? [textPart(text)] : [], topicId: active.topicId, pendingProposal: null };
		}
		try {
			const lease = await this.readActiveRun();
			if (lease?.runId !== active.runId) return;
			if (result.topicId && result.parts.length)
				await createTopicMessage(db, {
					id: active.messageId,
					topicId: result.topicId,
					role: 'assistant',
					parts: result.parts,
				});
			if (result.pendingProposal && status === 'completed') await this.ctx.storage.put(PENDING_PROPOSAL_KEY, result.pendingProposal);
		} catch (error) {
			status = 'failed';
			console.error('Chat persistence failed', error);
		} finally {
			const lease = await this.readActiveRun();
			if (lease?.runId === active.runId) {
				this.broadcast({ type: 'run.ended', ...active, topicId: result.topicId, parts: result.parts, status });
				await this.ctx.storage.delete(ACTIVE_RUN_KEY);
				this.abort = null;
			}
			if (status === 'completed') for (const task of deferred) this.ctx.waitUntil(task());
		}
	}

	private async recoverOrphanedRun() {
		if (this.abort) return;
		const active = await this.readActiveRun();
		if (!active) return;
		await createDb(this.env.DB).update(agentRun).set({ status: 'failed', completedAt: new Date() }).where(eq(agentRun.id, active.runId));
		this.broadcast({ type: 'run.ended', ...active, parts: [], status: 'failed' });
		await this.ctx.storage.delete(ACTIVE_RUN_KEY);
	}

	private async readActiveRun() {
		const parsed = ActiveRunSchema.safeParse(await this.ctx.storage.get(ACTIVE_RUN_KEY));
		if (!parsed.success) return null;
		return parsed.data;
	}
	private async readPendingProposal() {
		const parsed = StoredProposalSchema.safeParse(await this.ctx.storage.get(PENDING_PROPOSAL_KEY));
		if (!parsed.success) return null;
		return parsed.data;
	}
	async webSocketError(ws: WebSocket) {
		ws.close(1011, 'WebSocket error');
	}
}
