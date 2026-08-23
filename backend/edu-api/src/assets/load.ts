import { resolveAssetReadUrl } from "./access";
import { MAX_ASSET_BYTES } from "./limits";
import { attachmentRefs, listOwnedAssetsByIds } from "./repository";
import type { Db } from "../../db/client";
import type { MessagePart } from "../messages/schema";

export type AgentImage = {
	dataUrl: string;
};

function toBase64(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	const pieces: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		const slice = bytes.subarray(offset, offset + chunkSize);
		pieces.push(String.fromCharCode(...slice));
	}
	return btoa(pieces.join(""));
}

export async function loadAttachedImages(
	env: Env,
	db: Db,
	userId: string,
	parts: MessagePart[],
) {
	const refs = attachmentRefs(parts);
	if (refs.length === 0) {
		return [];
	}

	if (!env.ASSETS) {
		throw new Error("ASSETS bucket is not configured");
	}

	const rows = await listOwnedAssetsByIds(db, userId, [...new Set(refs)]);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const images: AgentImage[] = [];

	for (const ref of refs) {
		const row = byId.get(ref);
		if (!row) {
			throw new Error("Attachment not found");
		}
		const object = await env.ASSETS.get(row.storageKey);
		if (!object) {
			throw new Error("Attachment file is missing");
		}
		if (object.size > MAX_ASSET_BYTES) {
			throw new Error("Attachment file is too large");
		}
		const buffer = await object.arrayBuffer();
		images.push({
			dataUrl: `data:${row.mimeType};base64,${toBase64(buffer)}`,
		});
	}

	return images;
}

export async function hydrateAttachmentParts(
	env: Env,
	db: Db,
	userId: string,
	parts: MessagePart[],
	origin: string,
) {
	const refs = attachmentRefs(parts);
	if (refs.length === 0) {
		return parts;
	}

	const rows = await listOwnedAssetsByIds(db, userId, [...new Set(refs)]);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const urls = new Map<string, string>();

	for (const row of rows) {
		try {
			urls.set(
				row.id,
				await resolveAssetReadUrl({
					env,
					origin,
					assetId: row.id,
					storageKey: row.storageKey,
				}),
			);
		} catch {
			continue;
		}
	}

	return parts.map((part) => {
		if (part.type !== "attachment") {
			return part;
		}
		const row = byId.get(part.ref);
		const url = urls.get(part.ref);
		if (!row || !url) {
			return part;
		}
		return {
			type: "attachment" as const,
			ref: part.ref,
			url,
			filename: row.filename ?? undefined,
			mimeType: row.mimeType,
		};
	});
}
