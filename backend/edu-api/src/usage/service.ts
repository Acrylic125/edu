import { and, asc, eq, gte } from 'drizzle-orm';

import type { Db } from '../../db/client';
import { topic, topicMessage } from '../../db/schema';

const PERIODS = ['1d', '7d', '1mo', 'mtd', 'ytd'] as const;

type UsagePeriod = (typeof PERIODS)[number];
type Granularity = 'hour' | 'day' | 'month';
type UsageRow = {
	role: 'user' | 'assistant';
	createdAt: Date;
};

function startOfUtcHour(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function startOfUtcDay(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtc(date: Date, granularity: Granularity, amount: number) {
	const next = new Date(date);
	if (granularity === 'hour') {
		next.setUTCHours(next.getUTCHours() + amount);
	} else if (granularity === 'day') {
		next.setUTCDate(next.getUTCDate() + amount);
	} else {
		next.setUTCMonth(next.getUTCMonth() + amount);
	}
	return next;
}

function periodDefinition(period: UsagePeriod, now: Date) {
	if (period === '1d') {
		return {
			granularity: 'hour' as const,
			start: addUtc(startOfUtcHour(now), 'hour', -23),
		};
	}

	if (period === '7d') {
		return {
			granularity: 'day' as const,
			start: addUtc(startOfUtcDay(now), 'day', -6),
		};
	}

	if (period === '1mo') {
		return {
			granularity: 'day' as const,
			start: addUtc(startOfUtcDay(now), 'day', -29),
		};
	}

	if (period === 'mtd') {
		return {
			granularity: 'day' as const,
			start: startOfUtcMonth(now),
		};
	}

	return {
		granularity: 'month' as const,
		start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
	};
}

function bucketStart(date: Date, granularity: Granularity) {
	if (granularity === 'hour') {
		return startOfUtcHour(date);
	}
	if (granularity === 'day') {
		return startOfUtcDay(date);
	}
	return startOfUtcMonth(date);
}

export function buildUsagePeriods(rows: UsageRow[], now: Date) {
	const end = new Date(now);

	return Object.fromEntries(
		PERIODS.map((period) => {
			const definition = periodDefinition(period, now);
			const buckets = [];

			for (
				let cursor = definition.start;
				cursor <= end;
				cursor = addUtc(cursor, definition.granularity, 1)
			) {
				buckets.push({
					timestamp: cursor.toISOString(),
					requests: 0,
					responses: 0,
				});
			}

			const bucketsByTimestamp = new Map(buckets.map((bucket) => [bucket.timestamp, bucket]));
			for (const row of rows) {
				if (row.createdAt < definition.start || row.createdAt > end) {
					continue;
				}

				const bucket = bucketsByTimestamp.get(bucketStart(row.createdAt, definition.granularity).toISOString());
				if (!bucket) {
					continue;
				}

				if (row.role === 'user') {
					bucket.requests += 1;
				} else {
					bucket.responses += 1;
				}
			}

			return [
				period,
				{
					granularity: definition.granularity,
					start: definition.start.toISOString(),
					end: end.toISOString(),
					buckets,
				},
			];
		}),
	) as Record<UsagePeriod, {
		granularity: Granularity;
		start: string;
		end: string;
		buckets: Array<{ timestamp: string; requests: number; responses: number }>;
	}>;
}

export async function getUserUsage(db: Db, userId: string, now = new Date()) {
	const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
	const rollingMonthStart = addUtc(startOfUtcDay(now), 'day', -29);
	const earliestStart = yearStart < rollingMonthStart ? yearStart : rollingMonthStart;

	const rows = await db
		.select({
			role: topicMessage.role,
			createdAt: topicMessage.createdAt,
		})
		.from(topicMessage)
		.innerJoin(topic, eq(topicMessage.topicId, topic.id))
		.where(and(eq(topic.userId, userId), gte(topicMessage.createdAt, earliestStart)))
		.orderBy(asc(topicMessage.createdAt));

	return {
		generatedAt: now.toISOString(),
		periods: buildUsagePeriods(rows, now),
	};
}
