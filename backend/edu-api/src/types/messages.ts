export type ClientMessage = {
	type: "message";
	content: string;
};

export type ServerMessage =
	| { type: "ready"; sessionId: string }
	| { type: "delta"; content: string }
	| { type: "done"; content: string }
	| { type: "error"; message: string }
	| { type: "busy"; message: string };

export type ChatRole = "user" | "assistant";

export type ChatTurn = {
	role: ChatRole;
	content: string;
};

type WsAttachment = {
	sessionId: string;
	agentRunning: boolean;
};

export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		(parsed as ClientMessage).type !== "message" ||
		typeof (parsed as ClientMessage).content !== "string"
	) {
		return null;
	}

	const content = (parsed as ClientMessage).content.trim();
	if (!content) {
		return null;
	}

	return { type: "message", content };
}

export function getWsAttachment(ws: WebSocket): WsAttachment | null {
	const attachment = ws.deserializeAttachment();
	if (
		typeof attachment !== "object" ||
		attachment === null ||
		typeof (attachment as WsAttachment).sessionId !== "string" ||
		typeof (attachment as WsAttachment).agentRunning !== "boolean"
	) {
		return null;
	}

	return attachment as WsAttachment;
}

export function setWsAttachment(ws: WebSocket, attachment: WsAttachment) {
	ws.serializeAttachment(attachment);
}
