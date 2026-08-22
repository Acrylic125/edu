import { DurableObject } from "cloudflare:workers";

import { runLunaAgent } from "../agent/luna-agent";
import {
	getWsAttachment,
	parseClientMessage,
	setWsAttachment,
	type ChatTurn,
	type ServerMessage,
} from "../types/messages";

const HISTORY_KEY = "history";

export class ChatDurableObject extends DurableObject<Env> {
	private sendJson(ws: WebSocket, message: ServerMessage) {
		ws.send(JSON.stringify(message));
	}

	private async getHistory(): Promise<ChatTurn[]> {
		return (await this.ctx.storage.get<ChatTurn[]>(HISTORY_KEY)) ?? [];
	}

	private async appendTurn(turn: ChatTurn) {
		const history = await this.getHistory();
		history.push(turn);
		await this.ctx.storage.put(HISTORY_KEY, history);
	}

	async fetch(request: Request): Promise<Response> {
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader?.toLowerCase() !== "websocket") {
			return new Response("Expected WebSocket upgrade.", { status: 426 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);

		const sessionId = this.ctx.id.toString();
		setWsAttachment(server, { sessionId, agentRunning: false });
		this.sendJson(server, { type: "ready", sessionId });

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		if (typeof message !== "string") {
			this.sendJson(ws, { type: "error", message: "Expected a text message." });
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

		const clientMessage = parseClientMessage(message);
		if (!clientMessage) {
			this.sendJson(ws, { type: "error", message: "Invalid message." });
			return;
		}

		setWsAttachment(ws, { ...attachment, agentRunning: true });

		try {
			const history = await this.getHistory();
			const reply = await runLunaAgent(
				this.env.AI,
				history,
				clientMessage.content,
			);

			await this.appendTurn({ role: "user", content: clientMessage.content });
			await this.appendTurn({ role: "assistant", content: reply });
			this.sendJson(ws, { type: "done", content: reply });
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "An unknown error occurred";
			this.sendJson(ws, { type: "error", message: errorMessage });
		} finally {
			setWsAttachment(ws, { ...attachment, agentRunning: false });
		}
	}

	async webSocketError(ws: WebSocket, error: unknown) {
		console.error("Chat durable object websocket error:", error);
		ws.close(1011, "WebSocket error.");
	}
}
