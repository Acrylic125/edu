import { QuotaStore } from '../billing/quota';
import { getUserPlan } from '../billing/account';
import { creditCosts } from '../billing/cost';
import { safetyLimits } from '../billing/plans';
import { DurableObject } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb } from '../../db/client';
import { agentRun, asset } from '../../db/schema';
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
import { listOwnedPdfDocuments, listTopicPdfDocuments } from '../documents/repository';

export const EDU_USER_ID_HEADER = 'X-Edu-User-Id';
export const EDU_SESSION_EXPIRES_HEADER = 'X-Edu-Session-Expires';
const ACTIVE_RUN_KEY = 'activeRun';
const PENDING_PROPOSAL_KEY = 'pendingProposal';
const WsAttachmentSchema = z.object({ userId: z.string(), expiresAt: z.number() });
const ActiveRunSchema = z.object({ runId: z.string(), messageId: z.string(), topicId: z.string().optional(), reservationId: z.string().optional(), requestId: z.string().optional() });
const StoredProposalSchema = z.object({
	request: ChatRequestSchema,
	proposalId: z.string(),
	topicId: z.string().nullable(),
	topicUpdatedAt: z.string().nullable().optional(),
	prompt: z.string(),
	proposal: ProposalSchema,
});

export class ChatDurableObject extends DurableObject<Env> {
	private abort: AbortController | null = null;
	private submitting = false;
	private quotas = new QuotaStore(this.ctx.storage);

	async throttleHttp() {
		return this.quotas.throttle('http', safetyLimits.httpRequestsPerMinute);
	}

	async usageSnapshot(userId: string) {
		return this.quotas.snapshot(await getUserPlan(this.env, userId));
	}

	async reserveUpload(userId: string, id: string, size: number, mimeType: string) {
		z.string().min(1).max(128).parse(id);
		z.number().int().positive().max(safetyLimits.pdfBytes).parse(size);
		const error = await this.quotas.throttle('uploads', safetyLimits.uploadRequestsPerMinute);
		if (error) return { ok: false as const, error };
		const plan = await getUserPlan(this.env, userId);
		// Register cleanup first so a rejected or abandoned upload still expires from R2.
		await this.quotas.registerUpload(id, userId, size);
		if (mimeType.startsWith('image/')) return this.quotas.reserve(`upload:${id}`, plan, creditCosts.imageUpload);
		return { ok: true as const, duplicate: false, status: 'reserved' as const };
	}

	async uploadState(id: string) {
		return this.quotas.upload(id);
	}

	async beginUpload(id: string) {
		return this.quotas.transitionUpload(id, 'pending', 'writing');
	}

	async finishUploadWrite(id: string, success: boolean) {
		if (success) return this.quotas.transitionUpload(id, 'writing', 'uploaded');
		return this.quotas.transitionUpload(id, 'writing', 'pending');
	}

	async beginUploadCompletion(id: string) {
		return this.quotas.transitionUpload(id, 'uploaded', 'completing');
	}

	async finishUploadCompletion(id: string, success: boolean) {
		if (!success) return this.quotas.transitionUpload(id, 'completing', 'uploaded');
		const completed = await this.quotas.transitionUpload(id, 'completing', 'complete');
		if (completed) {
			await this.quotas.settle(`upload:${id}`, false);
			await this.quotas.settle(`pdf:${id}`, false);
			await this.ctx.storage.setAlarm(Date.now() + 1000);
		}
		return completed;
	}

	async reservePdf(userId: string, id: string, pages: number) {
		z.number().int().positive().max(safetyLimits.pdfPagesPerFile).parse(pages);
		return this.quotas.reserve(`pdf:${id}`, await getUserPlan(this.env, userId), pages * creditCosts.pdfPage);
	}

	async alarm() {
		const documents = await this.ctx.storage.list({ prefix: 'pending-pdf:', limit: 100 });
		for (const [key, value] of documents) {
			const assetId = key.slice('pending-pdf:'.length);
			const userId = z.string().parse(value);
			await this.env.PDF_INDEX_QUEUE.send({ assetId, userId, nextPage: 1 });
			await this.ctx.storage.delete(key);
		}
		const pending = await this.ctx.storage.list({ prefix: 'pending-upload:', limit: 100 });
		for (const key of pending.keys()) {
			const id = key.slice('pending-upload:'.length);
			const upload = await this.quotas.expireUpload(id);
			if (!upload) continue;
			await this.env.ASSETS.delete(`${upload.userId}/${id}`);
			await createDb(this.env.DB).delete(asset).where(eq(asset.id, id));
			await this.quotas.settle(`upload:${id}`, true);
			await this.quotas.settle(`pdf:${id}`, true);
			await this.ctx.storage.delete(key);
		}
		if ((await this.ctx.storage.list({ prefix: 'pending-upload:', limit: 1 })).size || (await this.ctx.storage.list({ prefix: 'pending-pdf:', limit: 1 })).size) {
			await this.ctx.storage.setAlarm(Date.now() + 60_000);
		}
	}

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
		if (this.ctx.getWebSockets().length >= safetyLimits.webSocketConnections) return new Response('Too many connections', { status: 429 });
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
			this.sendJson(ws, { type: 'error', message: 'Tutor is already running', requestId: frame.type === 'message' ? frame.messageId : frame.proposalId });
			return;
		}
		// Acquire before the first await: Durable Object handlers can interleave at I/O.
		this.submitting = true;
		try {
			await this.recoverOrphanedRun();
			await this.submit(attachment.data.userId, frame, ws);
		} catch (error) {
			console.error('Chat submission failed', error);
			this.sendJson(ws, { type: 'error', message: 'Could not submit that request. Check the topic and attachments, then retry.', requestId: frame.type === 'message' ? frame.messageId : frame.proposalId });
		} finally {
			this.submitting = false;
		}
	}

	private async submit(userId: string, frame: Exclude<WsClientEnvelope, { type: 'stop' }>, ws: WebSocket) {
		const db = createDb(this.env.DB);
		let current = await getCurrentTopic(db, userId);
		if (frame.type === 'message' && frame.topicId && current?.topic.id !== frame.topicId) {
			const selected = await getTopicForUser(db, frame.topicId, userId);
			if (!selected) throw new Error('Topic not found');
			current = { topic: selected, part: null, currentStepId: null };
		}
		let stored: z.infer<typeof StoredProposalSchema> | null = null;
		let userMessageId = `msg_${nanoid()}`;
		if (frame.type === 'decision') {
			stored = await this.readPendingProposal();
			if (!stored || stored.proposalId !== frame.proposalId || stored.topicId !== (current?.topic.id ?? null))
				throw new Error('Stale proposal');
		} else {
			userMessageId = frame.messageId;
			const refs = attachmentRefs(frame.parts);
			if (refs.length > MAX_MESSAGE_ASSETS || new Set(refs).size !== refs.length) throw new Error('Invalid attachments');
			const owned = await listOwnedAssetsByIds(db, userId, refs);
			if (owned.length !== refs.length || owned.some((asset) => asset.topicMessageId !== null)) throw new Error('Attachment unavailable');
			for (const ref of refs) {
				if ((await this.quotas.upload(ref))?.status !== 'complete') throw new Error('Attachment upload is not complete');
			}
		}
		let reservationId: string | undefined;
		// Confirmations only apply an existing generated plan; they do not call the model.
		if (frame.type === 'message') {
			const id = `message:${frame.messageId}`;
			const admission = await this.quotas.reserve(id, await getUserPlan(this.env, userId), creditCosts.turn);
			if (!admission.ok) {
				this.sendJson(ws, { type: 'error', ...admission.error, requestId: frame.messageId });
				return;
			}
			if (admission.duplicate) {
				this.sendJson(ws, { type: 'error', code: 'already_submitted', message: 'This request was already submitted. Refresh to see its result, or send a new request.', requestId: frame.messageId });
				return;
			}
			reservationId = id;
		}
		try {
			if (frame.type === 'message') {
				if (current) {
					await setCurrentTopic(db, userId, current.topic.id, current.part, current.currentStepId);
					await createTopicMessage(db, { id: userMessageId, topicId: current.topic.id, role: 'user', parts: persistableParts(frame.parts) });
					await linkAssetsToMessage(db, { userId, messageId: userMessageId, parts: frame.parts });
				}
			}
			await this.ctx.storage.delete(PENDING_PROPOSAL_KEY);
			const active = { runId: `run_${nanoid()}`, messageId: `msg_${nanoid()}`, topicId: current?.topic.id, reservationId, requestId: frame.type === 'message' ? frame.messageId : frame.proposalId };
			const abort = new AbortController();
			await this.ctx.storage.put(ACTIVE_RUN_KEY, active);
			this.abort = abort;
			this.broadcast({ type: 'run.started', ...active });
			this.ctx.waitUntil(
				this.execute(userId, userMessageId, active, frame, stored, AbortSignal.any([abort.signal, AbortSignal.timeout(safetyLimits.runTimeoutMs)])),
			);
		} catch (error) {
			if (reservationId) await this.quotas.settle(reservationId, true);
			throw error;
		}
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
			env: this.env,
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
				let documents = await listOwnedPdfDocuments(db, userId, attachmentRefs(frame.parts));
				if (active.topicId) {
					const topicDocuments = await listTopicPdfDocuments(db, userId, active.topicId);
					documents = [...new Map([...topicDocuments, ...documents].map((document) => [document.assetId, document])).values()];
				}
				result = await handleChat(db, this.env, userId, frame, { ...io, images, documents });
			} else if (stored) {
				result = await handleDecision(db, this.env, userId, stored, frame.decision, io);
			}
			if (!result.committed) signal.throwIfAborted();
		} catch (error) {
			if (signal.aborted && !(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')) status = 'cancelled';
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
				if (active.reservationId) await this.quotas.settle(active.reservationId, status === 'failed' && !accumulated && !result.committed);
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
		// An interrupted worker may already have incurred provider cost; keep its debit.
		if (active.reservationId) await this.quotas.settle(active.reservationId, false);
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
