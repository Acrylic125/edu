import { describe, expect, it } from 'vitest';
import { QuotaStore, quotaPeriod } from './quota';
import { plans, safetyLimits } from './plans';

function storageFixture() {
	let records = new Map<string, object | number | string | boolean>();
	let queue = Promise.resolve();
	let alarm: number | null = null;
	const storage = {
		get: async (key: string) => records.get(key),
		put: async (key: string, value: object | number | string | boolean) => { records.set(key, value); },
		delete: async (key: string) => records.delete(key),
		getAlarm: async () => alarm,
		setAlarm: async (value: number) => { alarm = value; },
		transaction: <T>(fn: (txn: DurableObjectTransaction) => Promise<T>) => {
			const next = queue.then(async () => {
				const copy = new Map(records);
				const txn = {
					get: async (key: string) => copy.get(key),
					put: async (key: string, value: object | number | string | boolean) => { copy.set(key, value); },
					delete: async (key: string) => copy.delete(key),
				} as Partial<DurableObjectTransaction> as DurableObjectTransaction;
				const result = await fn(txn);
				records = copy;
				return result;
			});
			queue = next.then(() => {}, () => {});
			return next;
		},
	} as Partial<DurableObjectStorage> as DurableObjectStorage;
	return { storage, quotas: new QuotaStore(storage) };
}
const now = Date.parse('2026-09-08T12:00:00Z');
const request = { aiRequestsPerDay: 1, aiRequestsPerMonth: 1 };

describe('persistent plan allowances', () => {
	it('atomically completes uploads with a durable PDF outbox entry', async () => {
		const { quotas, storage } = storageFixture();
		await quotas.registerUpload('a', 'u', 100, now);
		await quotas.reserve('pdf:a', 'free', { pdfPagesPerMonth: 2 }, now);
		await quotas.transitionUpload('a', 'pending', 'writing', now);
		await quotas.transitionUpload('a', 'writing', 'uploaded', now);
		await quotas.transitionUpload('a', 'uploaded', 'completing', now);
		await quotas.transitionUpload('a', 'completing', 'complete', now);
		expect(await storage.get('pending-pdf:a')).toBe('u');
		expect(await storage.get('pending-upload:a')).toBeUndefined();
	});
	it('atomically admits only the remaining allowance under concurrent submissions', async () => {
		const { quotas } = storageFixture();
		const results = await Promise.all(Array.from({ length: 30 }, (_, i) => quotas.reserve(`m${i}`, 'free', request, now + i * 60_001)));
		expect(results.filter((result) => result.ok)).toHaveLength(plans.free.aiRequestsPerDay);
		const snapshot = await quotas.snapshot('free', now);
		expect(snapshot.allowances.find((item) => item.metric === 'aiRequestsPerMonth')?.used).toBe(20);
	});

	it('persists the rolling-minute limiter across object recreation', async () => {
		const { quotas, storage } = storageFixture();
		for (let i = 0; i < 5; i++) await quotas.reserve(`m${i}`, 'free', request, now + i);
		const resumed = new QuotaStore(storage);
		expect(await resumed.reserve('blocked', 'free', request, now + 10)).toMatchObject({ ok: false, error: { metric: 'aiRequestsPerMinute', retryAfter: 60 } });
		expect(await resumed.reserve('next', 'free', request, now + 60_000)).toMatchObject({ ok: true });
	});

	it('does not rerun or recharge duplicate reservations even after refund', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('m1', 'free', request, now);
		expect(await quotas.reserve('m1', 'free', request, now)).toMatchObject({ ok: true, duplicate: true });
		await quotas.settle('m1', true);
		await quotas.settle('m1', true);
		expect(await quotas.reserve('m1', 'free', request, now)).toMatchObject({ duplicate: true, status: 'refunded' });
		expect((await quotas.snapshot('free', now)).allowances[0].used).toBe(0);
	});

	it('refunds the original UTC period without altering the new period', async () => {
		const { quotas } = storageFixture();
		const end = Date.parse('2026-09-30T23:59:59Z');
		await quotas.reserve('old', 'free', request, end);
		await quotas.reserve('new', 'free', request, end + 60_001);
		await quotas.settle('old', true);
		expect((await quotas.snapshot('free', end)).allowances[1].used).toBe(0);
		expect((await quotas.snapshot('free', end + 60_001)).allowances[1].used).toBe(1);
		expect(quotaPeriod('aiRequestsPerMonth', Date.parse('2026-12-31T23:59:59Z')).resetAt).toBe('2027-01-01T00:00:00.000Z');
	});

	it('preserves usage on upgrades and downgrades and isolates users', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('m', 'free', request, now);
		expect((await quotas.snapshot('pro', now)).allowances[1]).toMatchObject({ used: 1, limit: 2000, remaining: 1999 });
		expect((await quotas.snapshot('free', now)).allowances[1]).toMatchObject({ used: 1, remaining: 99 });
		expect((await storageFixture().quotas.snapshot('free', now)).allowances[1].used).toBe(0);
	});

	it('does not increment other metrics when a compound reservation exceeds storage', async () => {
		const { quotas } = storageFixture();
		await quotas.initializeStorage(plans.free.storageBytes);
		expect(await quotas.reserve('upload', 'free', { uploadsPerMonth: 1, storageBytes: 1 }, now)).toMatchObject({ ok: false, error: { metric: 'storageBytes', resetAt: null } });
		expect((await quotas.snapshot('free', now)).allowances.find((item) => item.metric === 'uploadsPerMonth')?.used).toBe(0);
		await quotas.initializeStorage(0);
		expect((await quotas.snapshot('free', now)).allowances.at(-1)?.used).toBe(plans.free.storageBytes);
	});

	it('counts PDF pages once across queue retries and enforces the page allowance', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('pdf:a', 'free', { pdfPagesPerMonth: 90 }, now);
		expect(await quotas.reserve('pdf:a', 'free', { pdfPagesPerMonth: 90 }, now)).toMatchObject({ duplicate: true });
		expect(await quotas.reserve('pdf:b', 'free', { pdfPagesPerMonth: 11 }, now)).toMatchObject({ ok: false, error: { metric: 'pdfPagesPerMonth', remaining: 10 } });
	});

	it('prevents overlapping writes, completed overwrites and expired completion', async () => {
		const { quotas } = storageFixture();
		await quotas.registerUpload('a', 'u', 100, now);
		const starts = await Promise.all([quotas.transitionUpload('a', 'pending', 'writing', now), quotas.transitionUpload('a', 'pending', 'writing', now)]);
		expect(starts).toEqual([true, false]);
		expect(await quotas.transitionUpload('a', 'writing', 'uploaded', now)).toBe(true);
		expect(await quotas.transitionUpload('a', 'uploaded', 'completing', now)).toBe(true);
		expect(await quotas.transitionUpload('a', 'completing', 'complete', now)).toBe(true);
		expect(await quotas.expireUpload('a', now + safetyLimits.uploadExpiresMs)).toBeNull();
		await quotas.registerUpload('b', 'u', 100, now);
		expect(await quotas.transitionUpload('b', 'pending', 'writing', now + safetyLimits.uploadExpiresMs)).toBe(false);
		expect(await quotas.expireUpload('b', now + safetyLimits.uploadExpiresMs)).toMatchObject({ userId: 'u' });
	});

	it('keeps settled debits and throttles even refunded submissions', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('m', 'free', request, now);
		await quotas.settle('m', false);
		await quotas.settle('m', true);
		expect((await quotas.snapshot('free', now)).allowances[0].used).toBe(1);
		for (let i = 0; i < safetyLimits.uploadRequestsPerMinute; i++) expect(await quotas.throttle('uploads', safetyLimits.uploadRequestsPerMinute, now)).toBeNull();
		expect(await quotas.throttle('uploads', safetyLimits.uploadRequestsPerMinute, now)).toMatchObject({ code: 'limit_exceeded' });
	});
});
