import { DurableObject } from "cloudflare:workers";

import { createDb } from "../../db/client";
import { handleChat } from "../chat/route";
import {
	WsChatClientMessageSchema,
	type WsServerMessage,
} from "../messages/schema";

export const EDU_USER_ID_HEADER = "X-Edu-User-Id";

type WsAttachment = {
	userId: string;
	agentRunning: boolean;
};

function getWsAttachment(ws: WebSocket) {
	const attachment = ws.deserializeAttachment();
	const parsed = attachment as WsAttachment | null;

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof parsed.userId !== "string" ||
		typeof parsed.agentRunning !== "boolean"
	) {
		return null;
	}

	return parsed;
}

function setWsAttachment(ws: WebSocket, attachment: WsAttachment) {
	ws.serializeAttachment(attachment);
}

export class ChatDurableObject extends DurableObject<Env> {
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
		setWsAttachment(server, { userId, agentRunning: false });
		this.sendJson(server, { type: "ready", userId });

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

		if (attachment.agentRunning) {
			this.sendJson(ws, {
				type: "busy",
				message: "Agent is already running.",
			});
			return;
		}

		let parsedMessage: unknown;
		try {
			parsedMessage = JSON.parse(message);
		} catch {
			this.sendJson(ws, { type: "error", message: "Invalid message." });
			return;
		}

		const clientMessage = WsChatClientMessageSchema.safeParse(parsedMessage);
		if (!clientMessage.success) {
			this.sendJson(ws, { type: "error", message: "Invalid message." });
			return;
		}

		setWsAttachment(ws, { ...attachment, agentRunning: true });

		try {
			if (!this.env.DB) {
				this.sendJson(ws, {
					type: "error",
					message: "Database is not configured.",
				});
				return;
			}

			const db = createDb(this.env.DB);
			const result = await handleChat(
				db,
				{
					OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY,
					OPENROUTER_MODEL: this.env.OPENROUTER_MODEL,
				},
				attachment.userId,
				{
					message: clientMessage.data.message,
					parts: clientMessage.data.parts,
				},
			);

			this.sendJson(ws, {
				type: "response",
				...result,
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "An unknown error occurred";
			this.sendJson(ws, { type: "error", message: errorMessage });
		} finally {
			setWsAttachment(ws, { ...attachment, agentRunning: false });
		}
	}

	async webSocketError(ws: WebSocket, error: Error | string) {
		console.error("Chat durable object websocket error:", error);
		ws.close(1011, "WebSocket error.");
	}
}
