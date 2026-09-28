import { and, eq } from 'drizzle-orm';
import type { TopicPlanStep } from '@edu/chat-contract';

import type { Db } from '../../db/client';
import { topicDocument } from '../../db/schema';

export function initialDocument(plan: TopicPlanStep[], summary: string) {
	const first = plan.find((step) => step.parent === null) ?? plan[0];
	if (!first) return summary.trim();
	return `## ${first.label}\n\n${first.summary || summary}`;
}

export async function getTopicDocument(db: Db, topicId: string, plan: TopicPlanStep[], summary: string) {
	const [record] = await db.select().from(topicDocument).where(eq(topicDocument.topicId, topicId)).limit(1);
	if (record) return { markdown: record.markdown, updatedAt: record.updatedAt.toISOString() };
	return { markdown: initialDocument(plan, summary), updatedAt: '' };
}

export async function saveTopicDocument(
	db: Db,
	topicId: string,
	markdown: string,
	expectedUpdatedAt: string,
) {
	const expectedTime = expectedUpdatedAt ? Date.parse(expectedUpdatedAt) : 0;
	const now = new Date(Math.max(Date.now(), expectedTime + 1));
	if (expectedUpdatedAt === '') {
		const created = await db.insert(topicDocument).values({ topicId, markdown, updatedAt: now }).onConflictDoNothing().returning();
		if (created[0]) return { markdown, updatedAt: now.toISOString() };
		return null;
	}
	const updated = await db.update(topicDocument)
		.set({ markdown, updatedAt: now })
		.where(and(eq(topicDocument.topicId, topicId), eq(topicDocument.updatedAt, new Date(expectedUpdatedAt))))
		.returning();
	if (!updated[0]) return null;
	return { markdown, updatedAt: now.toISOString() };
}
