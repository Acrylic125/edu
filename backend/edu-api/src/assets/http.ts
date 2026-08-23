import { z } from "zod";

import { createDb } from "../../db/client";
import { requireUser } from "../lib/auth-middleware";
import { ALLOWED_ASSET_MIME_TYPES, MAX_ASSET_BYTES } from "./limits";
import { getOwnedAsset, insertAsset, updateAssetSize } from "./repository";
import { presignGetUrl, presignPutUrl } from "./r2";

const UploadUrlRequestSchema = z.object({
	filename: z.string().min(1).max(255),
	mimeType: z.enum(ALLOWED_ASSET_MIME_TYPES),
	size: z.number().int().positive().max(MAX_ASSET_BYTES),
});

function jsonResponse(data: object, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function requireAssetsBucket(env: Env) {
	if (!env.ASSETS) {
		return jsonResponse({ error: "ASSETS bucket is not configured" }, 500);
	}
	return null;
}

function requireDb(env: Env) {
	if (!env.DB) {
		return jsonResponse({ error: "DB is not configured" }, 500);
	}
	return null;
}

export async function handleAssetRequest(
	request: Request,
	env: Env,
	url: URL,
) {
	const uploadMatch = url.pathname === "/assets/upload-url";
	const completeMatch = url.pathname.match(/^\/assets\/([^/]+)\/complete\/?$/);
	const getUrlMatch = url.pathname.match(/^\/assets\/([^/]+)\/url\/?$/);

	if (!uploadMatch && !completeMatch && !getUrlMatch) {
		return null;
	}

	const authResult = await requireUser(request, env);
	if (authResult instanceof Response) {
		return authResult;
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

	if (uploadMatch && request.method === "POST") {
		let json: unknown;
		try {
			json = await request.json();
		} catch {
			return jsonResponse({ error: "Invalid JSON" }, 400);
		}

		const parsed = UploadUrlRequestSchema.safeParse(json);
		if (!parsed.success) {
			return jsonResponse({ error: "Invalid upload request" }, 400);
		}

		const created = await insertAsset(db, {
			userId: authResult.userId,
			filename: parsed.data.filename,
			mimeType: parsed.data.mimeType,
			size: parsed.data.size,
		});

		try {
			const signed = await presignPutUrl(env, {
				key: created.storageKey,
				mimeType: parsed.data.mimeType,
			});
			return jsonResponse({
				assetId: created.id,
				uploadUrl: signed.url,
				headers: signed.headers,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not create upload URL";
			return jsonResponse({ error: message }, 500);
		}
	}

	if (completeMatch && request.method === "POST") {
		const assetId = decodeURIComponent(completeMatch[1] ?? "");
		const row = await getOwnedAsset(db, authResult.userId, assetId);
		if (!row) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		const object = await env.ASSETS.head(row.storageKey);
		if (!object) {
			return jsonResponse({ error: "Upload not found" }, 400);
		}
		if (object.size > MAX_ASSET_BYTES) {
			await env.ASSETS.delete(row.storageKey);
			return jsonResponse(
				{ error: `File exceeds ${MAX_ASSET_BYTES} bytes` },
				400,
			);
		}

		await updateAssetSize(db, row.id, object.size);
		return jsonResponse({
			assetId: row.id,
			size: object.size,
			mimeType: row.mimeType,
			filename: row.filename,
		});
	}

	if (getUrlMatch && request.method === "GET") {
		const assetId = decodeURIComponent(getUrlMatch[1] ?? "");
		const row = await getOwnedAsset(db, authResult.userId, assetId);
		if (!row) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		try {
			const urlValue = await presignGetUrl(env, row.storageKey);
			return jsonResponse({
				assetId: row.id,
				url: urlValue,
				mimeType: row.mimeType,
				filename: row.filename,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not create download URL";
			return jsonResponse({ error: message }, 500);
		}
	}

	return jsonResponse({ error: "Method not allowed" }, 405);
}
