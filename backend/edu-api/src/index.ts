import { ChatDurableObject } from "./do/chat";

export { ChatDurableObject };

const chatPathPattern = /^\/chat\/([^/]+)\/?$/;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const chatMatch = url.pathname.match(chatPathPattern);

		if (!chatMatch) {
			return new Response("Not found", { status: 404 });
		}

		const sessionId = decodeURIComponent(chatMatch[1] ?? "").trim();
		if (!sessionId) {
			return new Response("Missing sessionId.", { status: 400 });
		}

		const durableObjectId = env.CHAT_DURABLE_OBJECT.idFromName(sessionId);
		const stub = env.CHAT_DURABLE_OBJECT.get(durableObjectId);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
