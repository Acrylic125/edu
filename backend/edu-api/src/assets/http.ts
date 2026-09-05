import { z } from 'zod';
import { readLimitedBody } from './body';

import { createDb } from '../../db/client';
import { requireUser } from '../lib/auth-middleware';
import { resolveAssetReadUrl, verifyAssetContentAccess } from './access';
import { ALLOWED_ASSET_MIME_TYPES, MAX_ASSET_BYTES } from './limits';
import { getAssetById, getOwnedAsset, insertAsset, updateAssetSize } from './repository';

const UploadUrlRequestSchema = z.object({
	filename: z.string().min(1).max(255),
	mimeType: z.enum(ALLOWED_ASSET_MIME_TYPES),
	size: z.number().int().positive().max(MAX_ASSET_BYTES),
});

function jsonResponse(data: object, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function requireAssetsBucket(env: Env) {
	if (!env.ASSETS) {
		return jsonResponse({ error: 'ASSETS bucket is not configured' }, 500);
	}
	return null;
}

function requireDb(env: Env) {
	if (!env.DB) {
		return jsonResponse({ error: 'DB is not configured' }, 500);
	}
	return null;
}

export async function handleAssetRequest(request: Request, env: Env, url: URL) {
	const uploadMatch = url.pathname === '/assets/upload-url';
	const contentMatch = url.pathname.match(/^\/assets\/([^/]+)\/content\/?$/);
	const completeMatch = url.pathname.match(/^\/assets\/([^/]+)\/complete\/?$/);
	const getUrlMatch = url.pathname.match(/^\/assets\/([^/]+)\/url\/?$/);

	if (!uploadMatch && !contentMatch && !completeMatch && !getUrlMatch) {
		return null;
	}

	const missingDb = requireDb(env);
	if (missingDb) {
		return missingDb;
	}

	const missingBucket = requireAssetsBucket(env);
	if (missingBucket) {
		return missingBucket;
	}

	const db = createDb(env.DB);

	// Signed read URLs for <img> — no Authorization header available.
	if (contentMatch && request.method === 'GET') {
		const assetId = decodeURIComponent(contentMatch[1] ?? '');
		const expiresRaw = url.searchParams.get('expires');
		const signature = url.searchParams.get('sig');
		if (!expiresRaw || !signature) {
			return jsonResponse({ error: 'Missing signature' }, 401);
		}

		const expiresAt = Number(expiresRaw);
		const ok = await verifyAssetContentAccess({
			secret: env.BETTER_AUTH_SECRET,
			assetId,
			expiresAt,
			signature,
		});
		if (!ok) {
			return jsonResponse({ error: 'Invalid or expired signature' }, 401);
		}

		const row = await getAssetById(db, assetId);
		if (!row) {
			return jsonResponse({ error: 'Not found' }, 404);
		}

		const object = await env.ASSETS.get(row.storageKey);
		if (!object) {
			return jsonResponse({ error: 'Not found' }, 404);
		}

		const headers = new Headers();
		headers.set('Content-Type', row.mimeType);
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Cache-Control', 'private, max-age=3600');
		return new Response(object.body, { status: 200, headers });
	}

	const authResult = await requireUser(request, env);
	if (authResult instanceof Response) {
		return authResult;
	}

	if (uploadMatch && request.method === 'POST') {
		let json: unknown;
		try {
			json = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096)));
		} catch {
			return jsonResponse({ error: 'Invalid JSON' }, 400);
		}

		const parsed = UploadUrlRequestSchema.safeParse(json);
		if (!parsed.success) {
			return jsonResponse({ error: 'Invalid upload request' }, 400);
		}

		const created = await insertAsset(db, {
			userId: authResult.userId,
			filename: parsed.data.filename,
			mimeType: parsed.data.mimeType,
			size: parsed.data.size,
		});

		// PUT through the Worker so local Miniflare R2 and remote both use ASSETS.
		const uploadUrl = new URL(`/assets/${created.id}/content`, url.origin).toString();

		return jsonResponse({
			assetId: created.id,
			uploadUrl,
			headers: {
				'Content-Type': parsed.data.mimeType,
			},
		});
	}

	if (contentMatch && request.method === 'PUT') {
		const assetId = decodeURIComponent(contentMatch[1] ?? '');
		const row = await getOwnedAsset(db, authResult.userId, assetId);
		if (!row) {
			return jsonResponse({ error: 'Not found' }, 404);
		}

		const contentType = request.headers.get('Content-Type');
		if (!contentType || contentType !== row.mimeType) {
			return jsonResponse({ error: 'Content-Type mismatch' }, 400);
		}

		let bytes: Uint8Array;
		try {
			bytes = await readLimitedBody(request, MAX_ASSET_BYTES);
		} catch {
			return jsonResponse({ error: 'File too large or unreadable' }, 413);
		}
		if (bytes.byteLength === 0) {
			return jsonResponse({ error: 'Empty body' }, 400);
		}
		if (bytes.byteLength > MAX_ASSET_BYTES) {
			return jsonResponse({ error: `File exceeds ${MAX_ASSET_BYTES} bytes` }, 400);
		}

		await env.ASSETS.put(row.storageKey, bytes, {
			httpMetadata: { contentType: row.mimeType },
		});

		return jsonResponse({
			assetId: row.id,
			size: bytes.byteLength,
		});
	}

	if (completeMatch && request.method === 'POST') {
		const assetId = decodeURIComponent(completeMatch[1] ?? '');
		const row = await getOwnedAsset(db, authResult.userId, assetId);
		if (!row) {
			return jsonResponse({ error: 'Not found' }, 404);
		}

		const object = await env.ASSETS.head(row.storageKey);
		if (!object) {
			return jsonResponse({ error: 'Upload not found' }, 400);
		}
		if (object.size > MAX_ASSET_BYTES) {
			await env.ASSETS.delete(row.storageKey);
			return jsonResponse({ error: `File exceeds ${MAX_ASSET_BYTES} bytes` }, 400);
		}

		await updateAssetSize(db, row.id, object.size);
		return jsonResponse({
			assetId: row.id,
			size: object.size,
			mimeType: row.mimeType,
			filename: row.filename,
		});
	}

	if (getUrlMatch && request.method === 'GET') {
		const assetId = decodeURIComponent(getUrlMatch[1] ?? '');
		const row = await getOwnedAsset(db, authResult.userId, assetId);
		if (!row) {
			return jsonResponse({ error: 'Not found' }, 404);
		}

		try {
			const urlValue = await resolveAssetReadUrl({
				env,
				origin: url.origin,
				assetId: row.id,
				storageKey: row.storageKey,
			});
			return jsonResponse({
				assetId: row.id,
				url: urlValue,
				mimeType: row.mimeType,
				filename: row.filename,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not create download URL';
			return jsonResponse({ error: message }, 500);
		}
	}

	return jsonResponse({ error: 'Method not allowed' }, 405);
}
