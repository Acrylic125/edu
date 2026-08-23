import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Db } from "../../db/client";
import { topicMessage } from "../../db/schema";
import { partsToText, persistableParts } from "./parts";
import {
	CreateTopicMessageSchema,
	MessagePartsSchema,
	MessageRoleSchema,
	PersistedTopicMessageSchema,
	ResponseMessageSchema,
	type CreateTopicMessageInput,
	type PersistedTopicMessage,
} from "./schema";

export type { PersistedTopicMessage, MessageRole, ResponseMessage } from "./schema";

export async function createTopicMessage(
	db: Db,
	params: CreateTopicMessageInput,
) {
	const input = CreateTopicMessageSchema.parse(params);
	const id = input.id ?? `msg_${nanoid()}`;
	const now = new Date();
	const parts = persistableParts(input.parts);

	await db.insert(topicMessage).values({
		id,
		topicId: input.topicId,
		role: input.role,
		parts,
		createdAt: now,
	});

	return PersistedTopicMessageSchema.parse({
		id,
		topicId: input.topicId,
		role: input.role,
		parts,
		createdAt: now,
	});
}

export async function loadAllMessages(db: Db, topicId: string) {
	const rows = await db
		.select()
		.from(topicMessage)
		.where(eq(topicMessage.topicId, topicId))
		.orderBy(asc(topicMessage.createdAt));

	return rows.map((row) => {
		const partsResult = MessagePartsSchema.safeParse(row.parts);
		const parts = partsResult.success ? partsResult.data : [];

		return PersistedTopicMessageSchema.parse({
			id: row.id,
			topicId: row.topicId,
			role: MessageRoleSchema.parse(row.role),
			parts,
			createdAt: row.createdAt,
		});
	});
}

export async function loadRecentMessages(
	db: Db,
	topicId: string,
	limit = 8,
) {
	const rows = await db
		.select()
		.from(topicMessage)
		.where(eq(topicMessage.topicId, topicId))
		.orderBy(desc(topicMessage.createdAt))
		.limit(limit);

	return rows.reverse().map((row) => {
		const partsResult = MessagePartsSchema.safeParse(row.parts);
		const parts = partsResult.success ? partsResult.data : [];

		return PersistedTopicMessageSchema.parse({
			id: row.id,
			topicId: row.topicId,
			role: MessageRoleSchema.parse(row.role),
			parts,
			createdAt: row.createdAt,
		});
	});
}

export async function countTopicMessages(db: Db, topicId: string) {
	const rows = await db
		.select({ id: topicMessage.id })
		.from(topicMessage)
		.where(eq(topicMessage.topicId, topicId));

	return rows.length;
}

export function toResponseMessage(msg: PersistedTopicMessage) {
	return ResponseMessageSchema.parse({
		id: msg.id,
		role: msg.role,
		parts: msg.parts,
		createdAt:
			msg.createdAt instanceof Date
				? msg.createdAt.toISOString()
				: msg.createdAt,
	});
}

export function formatMessageForModel(msg: PersistedTopicMessage) {
	return `${msg.role}: ${partsToText(msg.parts)}`;
}
