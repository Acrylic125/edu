import { describe, expect, it } from 'vitest';
import { plans, creditCosts } from './cost';
import { QuotaStore, quotaPeriod } from './quota';
import { safetyLimits } from './plans';

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

describe('credit allowances', () => {
	it('keeps every credit cost and plan limit in the shared policy', () => {
		expect(creditCosts).toEqual({ turn: 1, imageUpload: 1, pdfPage: 1 });
		expect(plans.free).toMatchObject({ creditsPer5Hours: 100, creditsPerWeek: 1_000 });
		expect(plans.pro).toMatchObject({ creditsPer5Hours: 1_000, creditsPerWeek: 15_000 });
	});

	it('atomically admits only the credits remaining in both plan windows', async () => {
		const { quotas } = storageFixture();
		const results = await Promise.all(
			Array.from({ length: plans.free.creditsPer5Hours + 10 }, (_, index) => quotas.reserve(`turn:${index}`, 'free', creditCosts.turn, now)),
		);
		expect(results.filter((result) => result.ok)).toHaveLength(plans.free.creditsPer5Hours);
		const snapshot = await quotas.snapshot('free', now);
		expect(snapshot.subscription.allowances).toEqual([
			expect.objectContaining({ metric: 'creditsPer5Hours', used: 100, remaining: 0 }),
			expect.objectContaining({ metric: 'creditsPerWeek', used: 100, remaining: 900 }),
		]);
	});

	it('uses aligned five-hour windows and Monday-based UTC weeks', () => {
		expect(quotaPeriod('creditsPer5Hours', now)).toEqual({
			key: '2026-09-08T09:00:00.000Z',
			resetAt: '2026-09-08T14:00:00.000Z',
		});
		expect(quotaPeriod('creditsPerWeek', now)).toEqual({
			key: '2026-09-07T00:00:00.000Z',
			resetAt: '2026-09-14T00:00:00.000Z',
		});
	});

	it('records multi-credit PDF work once in every usage view', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('pdf:a', 'free', 12 * creditCosts.pdfPage, now);
		const snapshot = await quotas.snapshot('free', now);
		expect(snapshot.periods['1d'].buckets.at(-1)).toMatchObject({ credits: 12 });
		expect(snapshot.periods['7d'].buckets.at(-1)).toMatchObject({ credits: 12 });
		expect(snapshot.periods.ytd.buckets.at(-1)).toMatchObject({ credits: 12 });
	});

	it('refunds failed work from its original windows and chart buckets', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('turn:a', 'free', creditCosts.turn, now);
		await quotas.settle('turn:a', true);
		const snapshot = await quotas.snapshot('free', now);
		expect(snapshot.subscription.allowances.every((allowance) => allowance.used === 0)).toBe(true);
		expect(snapshot.periods['1d'].buckets.at(-1)?.credits).toBe(0);
	});

	it('does not rerun or recharge duplicate reservations after settlement', async () => {
		const { quotas } = storageFixture();
		await quotas.reserve('turn:a', 'free', creditCosts.turn, now);
		await quotas.settle('turn:a', false);
		expect(await quotas.reserve('turn:a', 'free', creditCosts.turn, now)).toMatchObject({ duplicate: true, status: 'charged' });
		expect((await quotas.snapshot('free', now)).subscription.allowances[0]?.used).toBe(1);
	});

	it('preserves upload lifecycle protections independently of credit accounting', async () => {
		const { quotas } = storageFixture();
		await quotas.registerUpload('a', 'u', 100, now);
		const starts = await Promise.all([
			quotas.transitionUpload('a', 'pending', 'writing', now),
			quotas.transitionUpload('a', 'pending', 'writing', now),
		]);
		expect(starts).toEqual([true, false]);
		expect(await quotas.transitionUpload('a', 'writing', 'uploaded', now)).toBe(true);
		expect(await quotas.transitionUpload('a', 'uploaded', 'completing', now)).toBe(true);
		expect(await quotas.transitionUpload('a', 'completing', 'complete', now)).toBe(true);
		expect(await quotas.expireUpload('a', now + safetyLimits.uploadExpiresMs)).toBeNull();
	});

	it('keeps safety throttles separate from plan credits', async () => {
		const { quotas } = storageFixture();
		for (let index = 0; index < safetyLimits.uploadRequestsPerMinute; index += 1) {
			expect(await quotas.throttle('uploads', safetyLimits.uploadRequestsPerMinute, now)).toBeNull();
		}
		expect(await quotas.throttle('uploads', safetyLimits.uploadRequestsPerMinute, now)).toMatchObject({ code: 'limit_exceeded' });
		expect((await quotas.snapshot('free', now)).subscription.allowances[0]?.used).toBe(0);
	});
});
