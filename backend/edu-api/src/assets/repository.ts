import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "../../db/client";
import { asset } from "../../db/schema";
import type { MessagePart } from "../messages/schema";

export function attachmentRefs(parts: MessagePart[]) {
	const refs: string[] = [];
	for (const part of parts) {
		if (part.type === "attachment") {
			refs.push(part.ref);
		}
	}
	return refs;
}

export async function insertAsset(
	db: Db,
	params: {
		id?: string;
		userId: string;
		filename: string;
		mimeType: string;
		size: number;
	},
) {
	const id = params.id ?? `ast_${nanoid()}`;
	const now = new Date();
	const storageKey = `${params.userId}/${id}`;
	await db.insert(asset).values({
		id,
		userId: params.userId,
		orderIndex: 0,
		storageKey,
		filename: params.filename,
		mimeType: params.mimeType,
		size: params.size,
		metadata: null,
		createdAt: now,
	});
	return { id, storageKey, createdAt: now };
}

export async function getOwnedAsset(db: Db, userId: string, assetId: string) {
	const rows = await db
		.select()
		.from(asset)
		.where(and(eq(asset.id, assetId), eq(asset.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getAssetById(db: Db, assetId: string) {
	const rows = await db
		.select()
		.from(asset)
		.where(eq(asset.id, assetId))
		.limit(1);
	return rows[0] ?? null;
}

export async function updateAssetSize(db: Db, assetId: string, size: number) {
	await db.update(asset).set({ size }).where(eq(asset.id, assetId));
}

export async function listOwnedAssetsByIds(
	db: Db,
	userId: string,
	assetIds: string[],
) {
	if (assetIds.length === 0) {
		return [];
	}
	return db
		.select()
		.from(asset)
		.where(and(eq(asset.userId, userId), inArray(asset.id, assetIds)))
		.orderBy(asc(asset.orderIndex), asc(asset.createdAt));
}

export async function linkAssetsToMessage(
	db: Db,
	params: { userId: string; messageId: string; parts: MessagePart[] },
) {
	const refs = attachmentRefs(params.parts);
	if (refs.length === 0) {
		return;
	}

	const uniqueRefs = [...new Set(refs)];
	const rows = await listOwnedAssetsByIds(db, params.userId, uniqueRefs);
	if (rows.length !== uniqueRefs.length) {
		throw new Error("One or more attachments were not found");
	}

	for (const row of rows) {
		if (row.topicMessageId && row.topicMessageId !== params.messageId) {
			throw new Error("Attachment is already linked to another message");
		}
	}

	for (let index = 0; index < refs.length; index += 1) {
		const assetId = refs[index];
		if (!assetId) {
			continue;
		}
		await db
			.update(asset)
			.set({
				topicMessageId: params.messageId,
				orderIndex: index,
			})
			.where(
				and(
					eq(asset.id, assetId),
					eq(asset.userId, params.userId),
					isNull(asset.topicMessageId),
				),
			);
	}
}
