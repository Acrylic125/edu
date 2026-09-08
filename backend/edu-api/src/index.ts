import { ChatDurableObject, EDU_USER_ID_HEADER, EDU_SESSION_EXPIRES_HEADER } from './do/chat';
import { createDb } from '../db/client';
import { handleAssetRequest } from './assets/http';
import { hydrateAttachmentParts } from './assets/load';
import { selectTopic, selectTopicStep } from './chat/select-topic';
import { requireUser } from './lib/auth-middleware';
import { loadAllMessages, toResponseMessage } from './messages/persistence';
import { UpdateTopicRequestSchema } from './messages/schema';
import {
	getCurrentTopic,
	getTopicForUser,
	listUserTopics,
	updateCurrentPart,
	updateCurrentStep,
	updateTopicState,
} from './topics/repository';
import { learningStepsFromPlan } from './chat/new-topic';
import { indexPdfBatch } from './documents/pdf';
import { z } from 'zod';

export { ChatDurableObject };

const PdfIndexJobSchema = z.object({
	assetId: z.string().min(1).max(128),
	userId: z.string().min(1).max(128),
	nextPage: z.number().int().positive(),
});

function jsonResponse(data: object, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});
}

function withCors(env: Env, request: Request, response: Response) {
	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', env.WEB_ORIGIN);
	headers.set('Access-Control-Allow-Credentials', 'true');
	headers.set('Access-Control-Expose-Headers', 'Retry-After');
	const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
	if (requestedHeaders) {
		headers.set('Access-Control-Allow-Headers', requestedHeaders);
	} else {
		headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
	}
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		if (origin && origin !== env.WEB_ORIGIN && !['GET', 'OPTIONS'].includes(request.method))
			return new Response('Forbidden origin', { status: 403 });

		if (request.method === 'OPTIONS') {
			return withCors(env, request, new Response(null, { status: 204 }));
		}

		const assetResponse = await handleAssetRequest(request, env, url);
		if (assetResponse) {
			return withCors(env, request, assetResponse);
		}

		if (url.pathname === '/chat') {
			if (request.headers.get('Origin') !== env.WEB_ORIGIN) return new Response('Forbidden origin', { status: 403 });
			const upgradeHeader = request.headers.get('Upgrade');
			if (upgradeHeader?.toLowerCase() !== 'websocket') {
				return new Response('Expected WebSocket upgrade.', { status: 426 });
			}

			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return authResult;
			}

			if (!env.OPENROUTER_API_KEY) {
				return jsonResponse({ error: 'OPENROUTER_API_KEY is not configured' }, 500);
			}

			if (!env.CHAT_DURABLE_OBJECT) {
				return jsonResponse({ error: 'CHAT_DURABLE_OBJECT is not configured' }, 500);
			}

			const durableObjectId = env.CHAT_DURABLE_OBJECT.idFromName(authResult.userId);
			const stub = env.CHAT_DURABLE_OBJECT.get(durableObjectId);

			const headers = new Headers(request.headers);
			headers.set(EDU_USER_ID_HEADER, authResult.userId);
			headers.set(EDU_SESSION_EXPIRES_HEADER, String(authResult.expiresAt));

			return stub.fetch(
				new Request(request.url, {
					method: request.method,
					headers,
				}),
			);
		}

		const updateTopicMatch = url.pathname.match(/^\/topics\/([^/]+)\/?$/);
		if (updateTopicMatch && request.method === 'GET') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}
			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}
			const topicId = decodeURIComponent(updateTopicMatch[1] ?? '');
			const db = createDb(env.DB);
			const selected = await getCurrentTopic(db, authResult.userId);
			const existing = await getTopicForUser(db, topicId, authResult.userId);
			if (!existing) {
				return withCors(env, request, jsonResponse({ error: 'Topic not found' }, 404));
			}
			return withCors(env, request, jsonResponse({
				topic: {
					id: existing.id,
					title: existing.title,
					summary: existing.summary,
					plan: existing.plan,
					part: selected?.topic.id === topicId ? selected.part : null,
					currentStepId: selected?.topic.id === topicId ? selected.currentStepId : null,
					updatedAt: existing.updatedAt.toISOString(),
				},
			}));
		}
		if (updateTopicMatch && request.method === 'PATCH') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}
			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}

			let parsed;
			try {
				parsed = UpdateTopicRequestSchema.safeParse(await request.json());
			} catch {
				return withCors(env, request, jsonResponse({ error: 'Invalid request body' }, 400));
			}
			if (!parsed.success) {
				return withCors(env, request, jsonResponse({ error: 'Invalid learning plan' }, 400));
			}

			const topicId = decodeURIComponent(updateTopicMatch[1] ?? '');
			const db = createDb(env.DB);
			const existing = await getTopicForUser(db, topicId, authResult.userId);
			if (!existing) {
				return withCors(env, request, jsonResponse({ error: 'Topic not found' }, 404));
			}
			if (existing.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
				return withCors(env, request, jsonResponse({ error: 'This plan changed while you were editing it. Reopen it and try again.' }, 409));
			}

			const plan = learningStepsFromPlan(parsed.data.plan, parsed.data.title);
			const updatedAt = await updateTopicState(db, topicId, {
				title: parsed.data.title,
				summary: parsed.data.summary,
				plan,
			});
			const current = await getCurrentTopic(db, authResult.userId);
			let currentStepId = current?.topic.id === topicId ? current.currentStepId : null;
			let part = current?.topic.id === topicId ? current.part : null;
			if (!plan.some((step) => step.id === currentStepId)) {
				const fallback = plan.find((step) => step.parent === null) ?? plan[0];
				if (fallback && current?.topic.id === topicId) {
					currentStepId = fallback.id;
					part = fallback.label;
					await updateCurrentStep(db, authResult.userId, topicId, fallback.id);
					await updateCurrentPart(db, authResult.userId, fallback.label, topicId);
				}
			}

			return withCors(env, request, jsonResponse({
				topic: {
					id: topicId,
					title: parsed.data.title,
					summary: parsed.data.summary,
					plan,
					part,
					currentStepId,
					updatedAt: updatedAt.toISOString(),
				},
			}));
		}

		const selectMatch = url.pathname.match(/^\/topics\/([^/]+)\/select\/?$/);
		if (selectMatch && request.method === 'POST') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}

			const topicId = decodeURIComponent(selectMatch[1] ?? '');
			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}

			const db = createDb(env.DB);
			const result = await selectTopic(db, authResult.userId, topicId);

			if (!result.success) {
				return withCors(env, request, jsonResponse({ error: result.error ?? 'Not found' }, 404));
			}

			return withCors(env, request, jsonResponse({ success: true, topicId }));
		}

		const selectStepMatch = url.pathname.match(/^\/topics\/([^/]+)\/steps\/([^/]+)\/select\/?$/);
		if (selectStepMatch && request.method === 'POST') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}

			const topicId = decodeURIComponent(selectStepMatch[1] ?? '');
			const stepId = decodeURIComponent(selectStepMatch[2] ?? '');
			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}

			const db = createDb(env.DB);
			const result = await selectTopicStep(db, authResult.userId, topicId, stepId);
			if (!result.success) {
				return withCors(env, request, jsonResponse({ error: result.error ?? 'Not found' }, 404));
			}

			return withCors(env, request, jsonResponse({ success: true, topicId, stepId }));
		}

		if (url.pathname === '/topics/current/messages' && request.method === 'GET') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}

			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}

			const db = createDb(env.DB);
			const current = await getCurrentTopic(db, authResult.userId);
			if (!current) {
				return withCors(env, request, jsonResponse({ topic: null, messages: [] }));
			}

			const messages = await loadAllMessages(db, current.topic.id);
			const hydrated = [];
			for (const message of messages) {
				const parts = await hydrateAttachmentParts(env, db, authResult.userId, message.parts, url.origin);
				hydrated.push(
					toResponseMessage({
						...message,
						parts,
					}),
				);
			}
			return withCors(
				env,
				request,
				jsonResponse({
					topic: {
						id: current.topic.id,
						title: current.topic.title,
						summary: current.topic.summary,
						plan: current.topic.plan,
						part: current.part,
						currentStepId: current.currentStepId,
						updatedAt: current.topic.updatedAt.toISOString(),
					},
					messages: hydrated,
				}),
			);
		}

		if (url.pathname === '/topics' && request.method === 'GET') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}

			if (!env.DB) {
				return withCors(env, request, jsonResponse({ error: 'DB is not configured' }, 500));
			}

			const db = createDb(env.DB);
			const topics = await listUserTopics(db, authResult.userId);

			return withCors(
				env,
				request,
				jsonResponse({
					topics: topics.map((t) => ({
						id: t.id,
						title: t.title,
						summary: t.summary,
						createdAt: t.createdAt.toISOString(),
						updatedAt: t.updatedAt.toISOString(),
					})),
				}),
			);
		}

		if (url.pathname === '/usage' && request.method === 'GET') {
			const authResult = await requireUser(request, env);
			if (authResult instanceof Response) {
				return withCors(env, request, authResult);
			}

			const quotas = env.CHAT_DURABLE_OBJECT.get(env.CHAT_DURABLE_OBJECT.idFromName(authResult.userId));
			return withCors(env, request, jsonResponse(await quotas.usageSnapshot(authResult.userId)));
		}

		return new Response('Not found', { status: 404 });
	},
	async queue(batch, env) {
		for (const message of batch.messages) {
			const parsed = PdfIndexJobSchema.safeParse(message.body);
			if (!parsed.success) {
				message.ack();
				continue;
			}
			try {
				await indexPdfBatch(env, parsed.data);
				message.ack();
			} catch {
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<Env>;
