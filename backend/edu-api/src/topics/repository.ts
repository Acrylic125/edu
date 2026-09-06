import { and, asc, eq } from 'drizzle-orm';

import type { Db } from '../../db/client';
import { topic, userCurrentTopic } from '../../db/schema';
import { nanoid } from 'nanoid';
import type { TopicPlanStep } from '../messages/schema';

export type TopicRecord = {
	id: string;
	userId: string;
	title: string;
	summary: string;
	plan: TopicPlanStep[];
	createdAt: Date;
	updatedAt: Date;
};

export type CurrentTopicContext = {
	topic: TopicRecord;
	part: string | null;
	currentStepId: string | null;
};

export async function getCurrentTopic(db: Db, userId: string): Promise<CurrentTopicContext | null> {
	const rows = await db
		.select({
			id: topic.id,
			userId: topic.userId,
			title: topic.title,
			summary: topic.summary,
		plan: topic.plan,
			createdAt: topic.createdAt,
			updatedAt: topic.updatedAt,
			part: userCurrentTopic.part,
			currentStepId: userCurrentTopic.currentStepId,
		})
		.from(userCurrentTopic)
		.innerJoin(topic, eq(userCurrentTopic.topicId, topic.id))
		.where(and(eq(userCurrentTopic.userId, userId), eq(topic.userId, userId)))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	return {
		topic: {
			id: row.id,
			userId: row.userId,
			title: row.title,
			summary: row.summary,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			plan: row.plan,
		},
		part: row.part,
		currentStepId: row.currentStepId,
	};
}

export async function getTopicForUser(db: Db, topicId: string, userId: string): Promise<TopicRecord | null> {
	const rows = await db
		.select()
		.from(topic)
		.where(and(eq(topic.id, topicId), eq(topic.userId, userId)))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	return row;
}

export async function createTopic(
	db: Db,
	params: {
		userId: string;
		title: string;
		summary: string;
		part: string;
		plan?: TopicPlanStep[];
	},
): Promise<TopicRecord> {
	const id = `topic_${nanoid()}`;
	const now = new Date();

	await db.insert(topic).values({
		id,
		userId: params.userId,
		title: params.title,
		summary: params.summary,
		plan: params.plan ?? [],
		createdAt: now,
		updatedAt: now,
	});

	return {
		id,
		userId: params.userId,
		title: params.title,
		summary: params.summary,
		plan: params.plan ?? [],
		createdAt: now,
		updatedAt: now,
	};
}

export async function updateTopicState(
	db: Db,
	topicId: string,
	updates: {
		title?: string;
		summary?: string;
	},
): Promise<void> {
	const now = new Date();
	await db
		.update(topic)
		.set({ ...updates, updatedAt: now })
		.where(eq(topic.id, topicId));
}

export async function setCurrentTopic(db: Db, userId: string, topicId: string, part: string | null, currentStepId: string | null = null): Promise<void> {
	const now = new Date();

	const existing = await db
		.select({ userId: userCurrentTopic.userId })
		.from(userCurrentTopic)
		.where(eq(userCurrentTopic.userId, userId))
		.limit(1);

	if (existing[0]) {
			await db.update(userCurrentTopic).set({ topicId, part, currentStepId, updatedAt: now }).where(eq(userCurrentTopic.userId, userId));
	} else {
		await db.insert(userCurrentTopic).values({
			userId,
			topicId,
			part,
			currentStepId,
			updatedAt: now,
		});
	}
}

export async function updateCurrentStep(db: Db, userId: string, topicId: string, stepId: string): Promise<void> {
	await db.update(userCurrentTopic).set({ currentStepId: stepId, updatedAt: new Date() }).where(and(eq(userCurrentTopic.userId, userId), eq(userCurrentTopic.topicId, topicId)));
}

export async function updateCurrentPart(db: Db, userId: string, part: string, topicId: string): Promise<void> {
	const now = new Date();
	await db
		.update(userCurrentTopic)
		.set({ part, updatedAt: now })
		.where(and(eq(userCurrentTopic.userId, userId), eq(userCurrentTopic.topicId, topicId)));
}

export async function listUserTopics(db: Db, userId: string): Promise<TopicRecord[]> {
	return db.select().from(topic).where(eq(topic.userId, userId)).orderBy(asc(topic.createdAt));
}
