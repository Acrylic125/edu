import { createAuth } from "./auth";
import { ChatDurableObject, EDU_USER_ID_HEADER } from "./do/chat";
import { createDb } from "../db/client";
import { selectTopic } from "./chat/select-topic";
import { requireUser } from "./lib/auth-middleware";
import { listUserTopics } from "./topics/repository";

export { ChatDurableObject };

const authPathPrefix = "/api/auth/";

function jsonResponse(data: object, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith(authPathPrefix)) {
			const auth = createAuth(env);
			return auth.handler(request);
		}

		if (url.pathname === "/chat") {
			const upgradeHeader = request.headers.get("Upgrade");
			if (upgradeHeader?.toLowerCase() !== "websocket") {
				return new Response("Expected WebSocket upgrade.", { status: 426 });
			}

			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return authResult;
			}

			if (!env.OPENROUTER_API_KEY) {
				return jsonResponse(
					{ error: "OPENROUTER_API_KEY is not configured" },
					500,
				);
			}

			if (!env.CHAT_DURABLE_OBJECT) {
				return jsonResponse(
					{ error: "CHAT_DURABLE_OBJECT is not configured" },
					500,
				);
			}

			const durableObjectId = env.CHAT_DURABLE_OBJECT.idFromName(
				authResult.userId,
			);
			const stub = env.CHAT_DURABLE_OBJECT.get(durableObjectId);

			const headers = new Headers(request.headers);
			headers.set(EDU_USER_ID_HEADER, authResult.userId);

			return stub.fetch(
				new Request(request.url, {
					method: request.method,
					headers,
				}),
			);
		}

		const selectMatch = url.pathname.match(/^\/topics\/([^/]+)\/select\/?$/);
		if (selectMatch && request.method === "POST") {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return authResult;
			}

			const topicId = decodeURIComponent(selectMatch[1] ?? "");
			if (!env.DB) {
				return jsonResponse({ error: "DB is not configured" }, 500);
			}

			const db = createDb(env.DB);
			const result = await selectTopic(db, authResult.userId, topicId);

			if (!result.success) {
				return jsonResponse({ error: result.error ?? "Not found" }, 404);
			}

			return jsonResponse({ success: true, topicId });
		}

		if (url.pathname === "/topics" && request.method === "GET") {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return authResult;
			}

			if (!env.DB) {
				return jsonResponse({ error: "DB is not configured" }, 500);
			}

			const db = createDb(env.DB);
			const topics = await listUserTopics(db, authResult.userId);

			return jsonResponse({
				topics: topics.map((t) => ({
					id: t.id,
					title: t.title,
					summary: t.summary,
					createdAt: t.createdAt.toISOString(),
					updatedAt: t.updatedAt.toISOString(),
				})),
			});
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
