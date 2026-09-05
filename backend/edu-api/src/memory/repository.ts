import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "../../db/client";
import {
	asset,
	conversationMemory,
	topic,
	topicMessage,
} from "../../db/schema";
import { partsToText } from "../messages/parts";
import { MessagePartsSchema } from "../messages/schema";
import {
	MemoryImageAssetIdsSchema,
	MemoryKeywordsSchema,
	type RetrievedExchange,
} from "./schema";

export async function createConversationMemory(
	db: Db,
	params: {
		userId: string;
		topicId: string | null;
		userMessageId: string;
		agentMessageId: string;
		intent: string | null;
		summary: string;
		keywords: string[];
		imageAssetIds: string[];
	},
) {
	const now = new Date();
	const id = `mem_${nanoid()}`;
	await db
		.insert(conversationMemory)
		.values({
			id,
			...params,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: conversationMemory.userMessageId,
			set: {
				topicId: params.topicId,
				agentMessageId: params.agentMessageId,
				intent: params.intent,
				summary: params.summary,
				keywords: params.keywords,
				imageAssetIds: params.imageAssetIds,
				updatedAt: now,
			},
		});

	return id;
}

export async function listRecentConversationMemories(
	db: Db,
	userId: string,
	limit = 100,
) {
	const rows = await db
		.select()
		.from(conversationMemory)
		.where(eq(conversationMemory.userId, userId))
		.orderBy(desc(conversationMemory.createdAt))
		.limit(limit);

	return rows.map((row) => {
		const keywords = MemoryKeywordsSchema.safeParse(row.keywords);
		const imageAssetIds = MemoryImageAssetIdsSchema.safeParse(
			row.imageAssetIds,
		);
		return {
			id: row.id,
			topicId: row.topicId,
			intent: row.intent,
			summary: row.summary,
			keywords: keywords.success ? keywords.data : [],
			createdAt: row.createdAt,
			hasImages: imageAssetIds.success && imageAssetIds.data.length > 0,
		};
	});
}

export async function loadConversationExchanges(
	db: Db,
	userId: string,
	memoryIds: string[],
) {
	if (memoryIds.length === 0) {
		return [];
	}

	const memories = await db
		.select({
			id: conversationMemory.id,
			userMessageId: conversationMemory.userMessageId,
			agentMessageId: conversationMemory.agentMessageId,
			imageAssetIds: conversationMemory.imageAssetIds,
		})
		.from(conversationMemory)
		.where(
			and(
				eq(conversationMemory.userId, userId),
				inArray(conversationMemory.id, memoryIds),
			),
		);

	const exchanges: RetrievedExchange[] = [];
	for (const memory of memories) {
		const messages = await db
			.select({
				id: topicMessage.id,
				parts: topicMessage.parts,
			})
			.from(topicMessage)
			.innerJoin(topic, eq(topicMessage.topicId, topic.id))
			.where(
				and(
					eq(topic.userId, userId),
					inArray(topicMessage.id, [
						memory.userMessageId,
						memory.agentMessageId,
					]),
				),
			);

		const byId = new Map(
			messages.map((message) => {
				const parts = MessagePartsSchema.safeParse(message.parts);
				return [
					message.id,
					parts.success ? partsToText(parts.data) : "",
				] as const;
			}),
		);
		const imageIds = MemoryImageAssetIdsSchema.safeParse(
			memory.imageAssetIds,
		);
		let images: RetrievedExchange["images"] = [];
		if (imageIds.success && imageIds.data.length > 0) {
			images = await db
				.select({
					id: asset.id,
					filename: asset.filename,
					mimeType: asset.mimeType,
				})
				.from(asset)
				.where(
					and(
						eq(asset.userId, userId),
						inArray(asset.id, imageIds.data),
					),
				);
		}

		exchanges.push({
			memoryId: memory.id,
			request: byId.get(memory.userMessageId) ?? "",
			response: byId.get(memory.agentMessageId) ?? "",
			images,
		});
	}

	return exchanges;
}
