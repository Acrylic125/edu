import { describe, expect, it } from 'vitest';

import { buildUsagePeriods } from './service';

describe('buildUsagePeriods', () => {
	it('groups persisted requests and responses into each requested period', () => {
		const now = new Date('2026-09-06T10:35:00.000Z');
		const usage = buildUsagePeriods(
			[
				{ role: 'user', createdAt: new Date('2026-09-06T10:05:00.000Z') },
				{ role: 'assistant', createdAt: new Date('2026-09-06T10:06:00.000Z') },
				{ role: 'user', createdAt: new Date('2026-09-05T09:00:00.000Z') },
			],
			now,
		);

		expect(usage['1d'].granularity).toBe('hour');
		expect(usage['1d'].buckets).toHaveLength(24);
		expect(usage['1d'].buckets.at(-1)).toMatchObject({ requests: 1, responses: 1 });
		expect(usage['7d'].buckets).toHaveLength(7);
		expect(usage['7d'].buckets.at(-1)).toMatchObject({ requests: 1, responses: 1 });
		expect(usage.ytd.granularity).toBe('month');
		expect(usage.ytd.buckets).toHaveLength(9);
		expect(usage.ytd.buckets.at(-1)).toMatchObject({ requests: 2, responses: 1 });
	});

	it('starts month-to-date at the first UTC day of the month', () => {
		const usage = buildUsagePeriods([], new Date('2026-09-06T10:35:00.000Z'));

		expect(usage.mtd.start).toBe('2026-09-01T00:00:00.000Z');
		expect(usage.mtd.buckets).toHaveLength(6);
	});
});
