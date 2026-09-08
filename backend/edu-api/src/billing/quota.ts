import { z } from 'zod';
import { PlanSchema, plans } from './cost';
import { safetyLimits } from './plans';

export const MetricSchema = z.enum(['creditsPer5Hours', 'creditsPerWeek']);
const ChargeSchema = z.object({ metric: MetricSchema, key: z.string(), amount: z.number().int().nonnegative() });
const UsageChargeSchema = z.object({ key: z.string(), amount: z.number().int().nonnegative() });
const ReservationSchema = z.object({
	status: z.enum(['reserved', 'charged', 'refunded']),
	charges: z.array(ChargeSchema),
	usageCharges: z.array(UsageChargeSchema),
	createdAt: z.number(),
});
const LegacyReservationSchema = z.object({
	status: z.enum(['reserved', 'charged', 'refunded']),
	charges: z.array(z.object({ metric: z.string(), key: z.string(), amount: z.number().int().nonnegative() })),
	createdAt: z.number(),
});
const StoredReservationSchema = z.union([ReservationSchema, LegacyReservationSchema]);
export const LimitErrorSchema = z.object({
	code: z.literal('limit_exceeded'),
	metric: z.string(),
	message: z.string(),
	limit: z.number(),
	remaining: z.number(),
	resetAt: z.string().nullable(),
	retryAfter: z.number().int().nonnegative(),
});
const UploadSchema = z.object({
	userId: z.string(),
	size: z.number().int().positive(),
	expiresAt: z.number(),
	status: z.enum(['pending', 'writing', 'uploaded', 'completing', 'complete', 'expired']),
});

const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
const PERIODS = ['1d', '7d', '1mo', 'mtd', 'ytd'] as const;
type Granularity = 'hour' | 'day' | 'month';

export function quotaPeriod(metric: z.infer<typeof MetricSchema>, now: number) {
	if (metric === 'creditsPer5Hours') {
		// Epoch-aligned windows are always exactly five hours and reset consistently for every user.
		const start = Math.floor(now / FIVE_HOURS_MS) * FIVE_HOURS_MS;
		return { key: new Date(start).toISOString(), resetAt: new Date(start + FIVE_HOURS_MS).toISOString() };
	}
	const date = new Date(now);
	const day = date.getUTCDay();
	const daysSinceMonday = (day + 6) % 7;
	const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
	return { key: new Date(start).toISOString(), resetAt: new Date(start + 7 * 24 * 60 * 60 * 1_000).toISOString() };
}

function limitError(metric: string, limit: number, used: number, resetAt: string | null, now: number) {
	let message = 'You have used the credits available in your current window.';
	if (resetAt) message += ` Resets at ${resetAt.replace('T', ' ').replace('.000Z', ' UTC')}.`;
	return { code: 'limit_exceeded' as const, metric, message, limit, remaining: Math.max(0, limit - used), resetAt,
		retryAfter: resetAt ? Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000)) : 0 };
}

function startOfUtc(date: Date, granularity: Granularity) {
	if (granularity === 'hour') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
	if (granularity === 'day') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtc(date: Date, granularity: Granularity, amount: number) {
	const next = new Date(date);
	if (granularity === 'hour') next.setUTCHours(next.getUTCHours() + amount);
	else if (granularity === 'day') next.setUTCDate(next.getUTCDate() + amount);
	else next.setUTCMonth(next.getUTCMonth() + amount);
	return next;
}

function periodDefinition(period: (typeof PERIODS)[number], now: Date) {
	if (period === '1d') return { granularity: 'hour' as const, start: addUtc(startOfUtc(now, 'hour'), 'hour', -23) };
	if (period === '7d') return { granularity: 'day' as const, start: addUtc(startOfUtc(now, 'day'), 'day', -6) };
	if (period === '1mo') return { granularity: 'day' as const, start: addUtc(startOfUtc(now, 'day'), 'day', -29) };
	if (period === 'mtd') return { granularity: 'day' as const, start: startOfUtc(now, 'month') };
	return { granularity: 'month' as const, start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) };
}

function usageKeys(now: number) {
	const date = new Date(now);
	return (['hour', 'day', 'month'] as const).map((granularity) => `usage:${granularity}:${startOfUtc(date, granularity).toISOString()}`);
}

async function buildUsagePeriod(txn: DurableObjectTransaction, period: (typeof PERIODS)[number], now: Date) {
	const definition = periodDefinition(period, now);
	const buckets = [];
	for (let cursor = definition.start; cursor <= now; cursor = addUtc(cursor, definition.granularity, 1)) {
		const timestamp = cursor.toISOString();
		const credits = z.number().parse((await txn.get(`usage:${definition.granularity}:${timestamp}`)) ?? 0);
		buckets.push({ timestamp, credits });
	}
	return { granularity: definition.granularity, start: definition.start.toISOString(), end: now.toISOString(), buckets };
}

export class QuotaStore {
	constructor(private storage: DurableObjectStorage) {}

	async reserve(id: string, plan: z.infer<typeof PlanSchema>, credits: number, now = Date.now()) {
		if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error('Invalid credit amount');
		return this.storage.transaction(async (txn) => {
			const existing = await txn.get(`reservation:${id}`);
			if (existing) {
				const reservation = StoredReservationSchema.parse(existing);
				return { ok: true as const, duplicate: true, status: reservation.status };
			}
			const charges: z.infer<typeof ChargeSchema>[] = [];
			for (const metric of MetricSchema.options) {
				const period = quotaPeriod(metric, now);
				const key = `counter:${metric}:${period.key}`;
				const used = z.number().parse((await txn.get(key)) ?? 0);
				if (used + credits > plans[plan][metric]) return { ok: false as const, error: limitError(metric, plans[plan][metric], used, period.resetAt, now) };
				charges.push({ metric, key, amount: credits });
			}
			const usageCharges = usageKeys(now).map((key) => ({ key, amount: credits }));
			for (const charge of [...charges, ...usageCharges]) {
				const used = z.number().parse((await txn.get(charge.key)) ?? 0);
				await txn.put(charge.key, used + charge.amount);
			}
			await txn.put(`reservation:${id}`, { status: 'reserved', charges, usageCharges, createdAt: now } satisfies z.infer<typeof ReservationSchema>);
			return { ok: true as const, duplicate: false, status: 'reserved' as const };
		});
	}

	async settle(id: string, refund: boolean) {
		await this.storage.transaction(async (txn) => {
			const raw = await txn.get(`reservation:${id}`);
			if (!raw) return;
			const reservation = StoredReservationSchema.parse(raw);
			if (reservation.status !== 'reserved') return;
			if (refund) {
				const charges = 'usageCharges' in reservation ? [...reservation.charges, ...reservation.usageCharges] : reservation.charges;
				for (const charge of charges) {
					const used = z.number().parse((await txn.get(charge.key)) ?? 0);
					await txn.put(charge.key, Math.max(0, used - charge.amount));
				}
				reservation.status = 'refunded';
			} else reservation.status = 'charged';
			await txn.put(`reservation:${id}`, reservation);
		});
	}

	async snapshot(plan: z.infer<typeof PlanSchema>, now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const allowances = [];
			for (const metric of MetricSchema.options) {
				const period = quotaPeriod(metric, now);
				const used = z.number().parse((await txn.get(`counter:${metric}:${period.key}`)) ?? 0);
				allowances.push({ metric, used, limit: plans[plan][metric], remaining: Math.max(0, plans[plan][metric] - used), resetAt: period.resetAt });
			}
			const generatedAt = new Date(now).toISOString();
			const periods = {
				'1d': await buildUsagePeriod(txn, '1d', new Date(now)),
				'7d': await buildUsagePeriod(txn, '7d', new Date(now)),
				'1mo': await buildUsagePeriod(txn, '1mo', new Date(now)),
				mtd: await buildUsagePeriod(txn, 'mtd', new Date(now)),
				ytd: await buildUsagePeriod(txn, 'ytd', new Date(now)),
			};
			return { subscription: { plan, name: plans[plan].name, allowances }, generatedAt, periods, safetyLimits };
		});
	}

	async throttle(kind: 'http' | 'uploads', limit: number, now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const timestamps = z.array(z.number()).parse((await txn.get(`burst:${kind}`)) ?? []).filter((time) => time > now - 60_000);
			if (timestamps.length >= limit) return limitError(`${kind}RequestsPerMinute`, limit, timestamps.length, new Date(timestamps[0] + 60_000).toISOString(), now);
			await txn.put(`burst:${kind}`, [...timestamps, now]);
			return null;
		});
	}

	async registerUpload(id: string, userId: string, size: number, now = Date.now()) {
		await this.storage.put(`upload:${id}`, { userId, size, expiresAt: now + safetyLimits.uploadExpiresMs, status: 'pending' } satisfies z.infer<typeof UploadSchema>);
		await this.storage.put(`pending-upload:${id}`, id);
		const alarm = await this.storage.getAlarm();
		if (alarm === null || alarm > now + safetyLimits.uploadExpiresMs) await this.storage.setAlarm(now + safetyLimits.uploadExpiresMs);
	}

	async upload(id: string) {
		const raw = await this.storage.get(`upload:${id}`);
		if (!raw) return null;
		return UploadSchema.parse(raw);
	}

	async transitionUpload(id: string, from: z.infer<typeof UploadSchema>['status'], to: z.infer<typeof UploadSchema>['status'], now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const raw = await txn.get(`upload:${id}`);
			if (!raw) return false;
			const upload = UploadSchema.parse(raw);
			if (upload.status !== from || upload.expiresAt <= now) return false;
			await txn.put(`upload:${id}`, { ...upload, status: to });
			if (to === 'complete') {
				await txn.delete(`pending-upload:${id}`);
				if (await txn.get(`reservation:pdf:${id}`)) await txn.put(`pending-pdf:${id}`, upload.userId);
			}
			return true;
		});
	}

	async expireUpload(id: string, now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const raw = await txn.get(`upload:${id}`);
			if (!raw) return null;
			const upload = UploadSchema.parse(raw);
			if (upload.status === 'complete' || upload.expiresAt > now) return null;
			await txn.put(`upload:${id}`, { ...upload, status: 'expired' });
			return upload;
		});
	}
}
