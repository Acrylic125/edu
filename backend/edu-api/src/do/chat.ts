import { DurableObject } from "cloudflare:workers";
import { nanoid } from "nanoid";
import { z } from "zod";

import { createDb } from "../../db/client";
import { loadAttachedImages } from "../assets/load";
import { MAX_MESSAGE_ASSETS } from "../assets/limits";
import { attachmentRefs, linkAssetsToMessage } from "../assets/repository";
import { handleChat, handleDecision, type StoredProposal } from "../chat/route";
import { createTopicMessage } from "../messages/persistence";
import { persistableParts, textPart } from "../messages/parts";
import {
	ProposalSchema,
	WsClientEnvelopeSchema,
	type MessagePart,
	type WsServerMessage,
} from "../messages/schema";
import { getCurrentTopic, getTopicForUser, setCurrentTopic } from "../topics/repository";

export const EDU_USER_ID_HEADER = "X-Edu-User-Id";

const ACTIVE_RUN_KEY = "activeRun";
const PENDING_PROPOSAL_KEY = "pendingProposal";

const WsAttachmentSchema = z.object({
	userId: z.string(),
});

const ActiveRunSchema = z.object({
	runId: z.string(),
	messageId: z.string(),
});

const StoredProposalSchema = z.object({
	proposalId: z.string(),
	prompt: z.string(),
	proposal: ProposalSchema,
});

function getWsAttachment(ws: WebSocket) {
	const parsed = WsAttachmentSchema.safeParse(ws.deserializeAttachment());
	if (!parsed.success) {
		return null;
	}
	return parsed.data;
}

function setWsAttachment(ws: WebSocket, attachment: { userId: string }) {
	ws.serializeAttachment(attachment);
}

function isAbortError(error: unknown, signal: AbortSignal) {
	if (signal.aborted) {
		return true;
	}
	if (error instanceof Error && error.name === "AbortError") {
		return true;
	}
	return false;
}

export class ChatDurableObject extends DurableObject<Env> {
	private abort: AbortController | null = null;

	private broadcast(message: WsServerMessage) {
		const payload = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			socket.send(payload);
		}
	}

	private sendJson(ws: WebSocket, message: WsServerMessage) {
		ws.send(JSON.stringify(message));
	}

	async fetch(request: Request) {
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader?.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade.", { status: 426 });
		}

		const userId = request.headers.get(EDU_USER_ID_HEADER)?.trim();
		if (!userId) {
			return new Response("Missing user.", { status: 401 });
		}

		if (!this.env.OPENROUTER_API_KEY) {
			return new Response("OPENROUTER_API_KEY is not configured", {
				status: 500,
			});
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);
		setWsAttachment(server, { userId });

		// waitUntil work dies on DO restart; storage may still hold activeRun.
		await this.recoverOrphanedRun();

		const pending = await this.readPendingProposal();
		let pendingProposalId: string | null = null;
		if (pending) {
			pendingProposalId = pending.proposalId;
		}
		this.sendJson(server, {
			type: "ready",
			userId,
			pendingProposalId,
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		if (typeof message !== "string") {
			this.sendJson(ws, {
				type: "error",
				message: "Expected a text message.",
			});
			return;
		}

		const attachment = getWsAttachment(ws);
		if (!attachment) {
			this.sendJson(ws, { type: "error", message: "Invalid session." });
			return;
		}

		let parsedMessage: unknown;
		try {
			parsedMessage = JSON.parse(message);
		} catch {
			this.sendJson(ws, { type: "error", message: "Invalid message." });
			return;
		}

		const envelope = WsClientEnvelopeSchema.safeParse(parsedMessage);
		if (!envelope.success) {
			this.sendJson(ws, { type: "error", message: "Invalid message." });
			return;
		}

		let active = await this.readActiveRun();
		const frame = envelope.data;

		if (frame.type === "stop") {
			if (!active || frame.runId !== active.runId) {
				return;
			}
			this.abort?.abort();
			// Release the lock immediately so the client isn't blocked if the
			// LLM ignores AbortSignal (common with large image payloads).
			await this.forceEndRun(active, "cancelled");
			return;
		}

		if (active && !this.abort) {
			await this.recoverOrphanedRun();
			active = await this.readActiveRun();
		}

		if (active) {
			if (frame.type === "message") {
				this.sendJson(ws, {
					type: "error",
					message: "Agent is already running.",
					runId: active.runId,
				});
			}
			return;
		}

		try {
			if (frame.type === "message") {
				await this.submitMessage(
					attachment.userId,
					frame.message,
					frame.parts,
					frame.topicId,
				);
				return;
			}

			await this.submitDecision(
				attachment.userId,
				frame.proposalId,
				frame.decision,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to handle message.";
			this.sendJson(ws, { type: "error", message });
			await this.clearActiveRun();
		}
	}

	private async submitMessage(
		userId: string,
		userMessageId: string,
		parts: MessagePart[],
		clientTopicId?: string,
	) {
		if (!this.env.DB) {
			this.broadcast({
				type: "error",
				message: "Database is not configured.",
			});
			return;
		}

		const db = createDb(this.env.DB);

		if (clientTopicId) {
			const owned = await getTopicForUser(db, clientTopicId, userId);
			if (!owned) {
				this.broadcast({
					type: "error",
					message: "Topic not found.",
				});
				return;
			}
			const existing = await getCurrentTopic(db, userId);
			const part =
				existing?.topic.id === clientTopicId ? existing.part : null;
			await setCurrentTopic(db, userId, clientTopicId, part);
		}

		const current = await getCurrentTopic(db, userId);
		const persistedParts = persistableParts(parts);
		const refs = attachmentRefs(persistedParts);
		if (refs.length > MAX_MESSAGE_ASSETS) {
			this.broadcast({
				type: "error",
				message: `You can attach up to ${MAX_MESSAGE_ASSETS} images per message.`,
			});
			return;
		}

		if (current) {
			await createTopicMessage(db, {
				id: userMessageId,
				topicId: current.topic.id,
				role: "user",
				parts: persistedParts,
			});
			await linkAssetsToMessage(db, {
				userId,
				messageId: userMessageId,
				parts: persistedParts,
			});
		}

		const runId = `run_${nanoid()}`;
		const assistantMessageId = `msg_${nanoid()}`;
		const abort = new AbortController();
		this.abort = abort;
		await this.ctx.storage.put(ACTIVE_RUN_KEY, {
			runId,
			messageId: assistantMessageId,
		});

		if (current) {
			this.broadcast({
				type: "run.started",
				runId,
				messageId: assistantMessageId,
				topicId: current.topic.id,
			});
		} else {
			this.broadcast({
				type: "run.started",
				runId,
				messageId: assistantMessageId,
			});
		}

		this.ctx.waitUntil(
			this.executeRun({
				userId,
				userMessageId,
				assistantMessageId,
				runId,
				parts: persistedParts,
				signal: abort.signal,
			}),
		);
	}

	private async submitDecision(
		userId: string,
		proposalId: string,
		decision: "accept" | "reject",
	) {
		const stored = await this.readPendingProposal();
		if (!stored || stored.proposalId !== proposalId) {
			this.broadcast({
				type: "error",
				message: "No pending proposal.",
			});
			return;
		}

		if (!this.env.DB) {
			this.broadcast({
				type: "error",
				message: "Database is not configured.",
			});
			return;
		}

		const runId = `run_${nanoid()}`;
		const assistantMessageId = `msg_${nanoid()}`;
		const abort = new AbortController();
		this.abort = abort;
		await this.ctx.storage.put(ACTIVE_RUN_KEY, {
			runId,
			messageId: assistantMessageId,
		});

		const db = createDb(this.env.DB);
		const current = await getCurrentTopic(db, userId);
		if (current) {
			this.broadcast({
				type: "run.started",
				runId,
				messageId: assistantMessageId,
				topicId: current.topic.id,
			});
		} else {
			this.broadcast({
				type: "run.started",
				runId,
				messageId: assistantMessageId,
			});
		}

		this.ctx.waitUntil(
			this.executeDecisionRun({
				userId,
				userMessageId: `msg_${nanoid()}`,
				assistantMessageId,
				runId,
				stored,
				decision,
				signal: abort.signal,
			}),
		);
	}

	private async executeRun(params: {
		userId: string;
		userMessageId: string;
		assistantMessageId: string;
		runId: string;
		parts: MessagePart[];
		signal: AbortSignal;
	}) {
		const db = createDb(this.env.DB);
		let accumulated = "";

		try {
			const result = await handleChat(
				db,
				{
					LANGTRACE_API_HOST: this.env.LANGTRACE_API_HOST,
					LANGTRACE_API_KEY: this.env.LANGTRACE_API_KEY,
					OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY,
					OPENROUTER_MODEL: this.env.OPENROUTER_MODEL,
				},
				params.userId,
				{
					message: params.userMessageId,
					parts: params.parts,
				},
				{
					signal: params.signal,
					runId: params.runId,
					assistantMessageId: params.assistantMessageId,
					userMessageId: params.userMessageId,
					images: await loadAttachedImages(
						this.env,
						db,
						params.userId,
						params.parts,
					),
					onDelta: (partIndex, text) => {
						accumulated += text;
						this.broadcast({
							type: "run.delta",
							runId: params.runId,
							messageId: params.assistantMessageId,
							partIndex,
							text,
						});
					},
					onProgress: (label) => {
						this.broadcast({
							type: "run.progress",
							runId: params.runId,
							messageId: params.assistantMessageId,
							label,
						});
					},
					defer: (task) => {
						this.ctx.waitUntil(task);
					},
				},
			);

			await this.finishRun({
				db,
				runId: params.runId,
				messageId: params.assistantMessageId,
				parts: result.parts,
				topicId: result.topicId,
				status: "completed",
				pendingProposal: result.pendingProposal,
			});
		} catch (error) {
			if (isAbortError(error, params.signal)) {
				const parts: MessagePart[] = [];
				if (accumulated.length > 0) {
					parts.push(textPart(accumulated));
				}
				const current = await getCurrentTopic(db, params.userId);
				await this.finishRun({
					db,
					runId: params.runId,
					messageId: params.assistantMessageId,
					parts,
					topicId: current?.topic.id,
					status: "cancelled",
					pendingProposal: await this.readPendingProposal(),
				});
				return;
			}

			const errorMessage =
				error instanceof Error ? error.message : "An unknown error occurred";
			this.broadcast({
				type: "error",
				message: errorMessage,
				runId: params.runId,
			});
			await this.clearActiveRun();
		}
	}

	private async executeDecisionRun(params: {
		userId: string;
		userMessageId: string;
		assistantMessageId: string;
		runId: string;
		stored: StoredProposal;
		decision: "accept" | "reject";
		signal: AbortSignal;
	}) {
		const db = createDb(this.env.DB);
		let accumulated = "";

		try {
			const result = await handleDecision(
				db,
				{
					LANGTRACE_API_HOST: this.env.LANGTRACE_API_HOST,
					LANGTRACE_API_KEY: this.env.LANGTRACE_API_KEY,
					OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY,
					OPENROUTER_MODEL: this.env.OPENROUTER_MODEL,
				},
				params.userId,
				params.stored,
				params.decision,
				{
					signal: params.signal,
					runId: params.runId,
					assistantMessageId: params.assistantMessageId,
					userMessageId: params.userMessageId,
					onDelta: (partIndex, text) => {
						accumulated += text;
						this.broadcast({
							type: "run.delta",
							runId: params.runId,
							messageId: params.assistantMessageId,
							partIndex,
							text,
						});
					},
					onProgress: (label) => {
						this.broadcast({
							type: "run.progress",
							runId: params.runId,
							messageId: params.assistantMessageId,
							label,
						});
					},
					defer: (task) => {
						this.ctx.waitUntil(task);
					},
				},
			);

			await this.finishRun({
				db,
				runId: params.runId,
				messageId: params.assistantMessageId,
				parts: result.parts,
				topicId: result.topicId,
				status: "completed",
				pendingProposal: result.pendingProposal,
			});
		} catch (error) {
			if (isAbortError(error, params.signal)) {
				const parts: MessagePart[] = [];
				if (accumulated.length > 0) {
					parts.push(textPart(accumulated));
				}
				const current = await getCurrentTopic(db, params.userId);
				await this.finishRun({
					db,
					runId: params.runId,
					messageId: params.assistantMessageId,
					parts,
					topicId: current?.topic.id,
					status: "cancelled",
					pendingProposal: params.stored,
				});
				return;
			}

			const errorMessage =
				error instanceof Error ? error.message : "An unknown error occurred";
			this.broadcast({
				type: "error",
				message: errorMessage,
				runId: params.runId,
			});
			await this.clearActiveRun();
		}
	}

	private async finishRun(params: {
		db: ReturnType<typeof createDb>;
		runId: string;
		messageId: string;
		parts: MessagePart[];
		topicId?: string;
		status: "completed" | "cancelled" | "failed";
		pendingProposal: StoredProposal | null;
	}) {
		try {
			if (params.topicId && params.parts.length > 0) {
				await createTopicMessage(params.db, {
					id: params.messageId,
					topicId: params.topicId,
					role: "agent",
					parts: params.parts,
				});
			}

			if (params.pendingProposal) {
				await this.ctx.storage.put(PENDING_PROPOSAL_KEY, params.pendingProposal);
			} else {
				await this.ctx.storage.delete(PENDING_PROPOSAL_KEY);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to persist run result.";
			this.broadcast({
				type: "error",
				message,
				runId: params.runId,
			});
		} finally {
			const active = await this.readActiveRun();
			if (!active || active.runId !== params.runId) {
				// Stop already released this run; avoid a duplicate run.ended.
				return;
			}
			// Always unblock the client, even if persistence failed.
			if (params.topicId) {
				this.broadcast({
					type: "run.ended",
					runId: params.runId,
					messageId: params.messageId,
					parts: params.parts,
					status: params.status,
					topicId: params.topicId,
				});
			} else {
				this.broadcast({
					type: "run.ended",
					runId: params.runId,
					messageId: params.messageId,
					parts: params.parts,
					status: params.status,
				});
			}
			await this.clearActiveRun();
		}
	}

	private async forceEndRun(
		active: { runId: string; messageId: string },
		status: "cancelled" | "failed",
	) {
		const current = await this.readActiveRun();
		if (!current || current.runId !== active.runId) {
			return;
		}
		this.broadcast({
			type: "run.ended",
			runId: active.runId,
			messageId: active.messageId,
			parts: [],
			status,
		});
		await this.clearActiveRun();
	}

	private async recoverOrphanedRun() {
		if (this.abort) {
			return;
		}
		const active = await this.readActiveRun();
		if (!active) {
			return;
		}
		await this.forceEndRun(active, "failed");
	}

	private async clearActiveRun() {
		this.abort = null;
		await this.ctx.storage.delete(ACTIVE_RUN_KEY);
	}

	private async readActiveRun() {
		const value = await this.ctx.storage.get(ACTIVE_RUN_KEY);
		const parsed = ActiveRunSchema.safeParse(value);
		if (!parsed.success) {
			return null;
		}
		return parsed.data;
	}

	private async readPendingProposal() {
		const value = await this.ctx.storage.get(PENDING_PROPOSAL_KEY);
		const parsed = StoredProposalSchema.safeParse(value);
		if (!parsed.success) {
			return null;
		}
		return parsed.data;
	}

	async webSocketError(ws: WebSocket, error: Error | string) {
		console.error("Chat durable object websocket error:", error);
		ws.close(1011, "WebSocket error.");
	}
}
