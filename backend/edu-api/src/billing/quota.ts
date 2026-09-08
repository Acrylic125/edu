import { z } from 'zod';
import { PlanSchema, plans, safetyLimits } from './plans';

export const MetricSchema = z.enum(['aiRequestsPerDay', 'aiRequestsPerMonth', 'uploadsPerMonth', 'pdfPagesPerMonth', 'storageBytes']);
const ChargeSchema = z.object({ metric: MetricSchema, key: z.string(), amount: z.number().int().nonnegative() });
const ReservationSchema = z.object({
	status: z.enum(['reserved', 'charged', 'refunded']),
	charges: z.array(ChargeSchema),
	createdAt: z.number(),
});
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

export function quotaPeriod(metric: z.infer<typeof MetricSchema>, now: number) {
	const date = new Date(now);
	if (metric === 'storageBytes') return { key: 'lifetime', resetAt: null };
	if (metric === 'aiRequestsPerDay') {
		return { key: date.toISOString().slice(0, 10), resetAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString() };
	}
	return { key: date.toISOString().slice(0, 7), resetAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString() };
}

function limitError(metric: string, limit: number, used: number, resetAt: string | null, now: number) {
	let message = `${metric}: allowance reached.`;
	if (metric === 'storageBytes') message = 'Your attachment storage is full.';
	else if (metric === 'aiRequestsPerDay') message = 'You have used your daily AI requests.';
	else if (metric === 'aiRequestsPerMonth') message = 'You have used your monthly AI requests.';
	else if (metric === 'uploadsPerMonth') message = 'You have used your monthly file uploads.';
	else if (metric === 'pdfPagesPerMonth') message = 'This PDF exceeds your remaining monthly page allowance.';
	else message = 'Too many requests. Please wait before trying again.';
	if (resetAt) message += ` Resets at ${resetAt.replace('T', ' ').replace('.000Z', ' UTC')}.`;
	return { code: 'limit_exceeded' as const, metric, message, limit, remaining: Math.max(0, limit - used), resetAt,
		retryAfter: resetAt ? Math.max(1, Math.ceil((Date.parse(resetAt) - now) / 1000)) : 0 };
}

export class QuotaStore {
	constructor(private storage: DurableObjectStorage) {}

	async initializeStorage(bytes: number) {
		await this.storage.transaction(async (txn) => {
			if (await txn.get('storage-initialized')) return;
			await txn.put('counter:storageBytes:lifetime', bytes);
			await txn.put('storage-initialized', true);
		});
	}

	async reserve(id: string, plan: z.infer<typeof PlanSchema>, amounts: Partial<Record<z.infer<typeof MetricSchema>, number>>, now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const existing = await txn.get(`reservation:${id}`);
			if (existing) {
				const reservation = ReservationSchema.parse(existing);
				return { ok: true as const, duplicate: true, status: reservation.status };
			}
			const charges: z.infer<typeof ChargeSchema>[] = [];
			for (const metric of MetricSchema.options) {
				const amount = amounts[metric] ?? 0;
				if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid quota amount');
				if (!amount) continue;
				const period = quotaPeriod(metric, now);
				const key = `counter:${metric}:${period.key}`;
				const used = z.number().parse((await txn.get(key)) ?? 0);
				if (used + amount > plans[plan][metric]) return { ok: false as const, error: limitError(metric, plans[plan][metric], used, period.resetAt, now) };
				charges.push({ metric, key, amount });
			}
			if (amounts.aiRequestsPerMonth) {
				const timestamps = z.array(z.number()).parse((await txn.get('burst:ai')) ?? []).filter((time) => time > now - 60_000);
				if (timestamps.length >= plans[plan].aiRequestsPerMinute) {
					return { ok: false as const, error: limitError('aiRequestsPerMinute', plans[plan].aiRequestsPerMinute, timestamps.length, new Date(timestamps[0] + 60_000).toISOString(), now) };
				}
				await txn.put('burst:ai', [...timestamps, now]);
			}
			for (const charge of charges) {
				const used = z.number().parse((await txn.get(charge.key)) ?? 0);
				await txn.put(charge.key, used + charge.amount);
			}
			await txn.put(`reservation:${id}`, { status: 'reserved', charges, createdAt: now } satisfies z.infer<typeof ReservationSchema>);
			return { ok: true as const, duplicate: false, status: 'reserved' as const };
		});
	}

	async settle(id: string, refund: boolean) {
		await this.storage.transaction(async (txn) => {
			const raw = await txn.get(`reservation:${id}`);
			if (!raw) return;
			const reservation = ReservationSchema.parse(raw);
			if (reservation.status !== 'reserved') return;
			if (refund) {
				for (const charge of reservation.charges) {
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
			return { plan, name: plans[plan].name, allowances, aiRequestsPerMinute: plans[plan].aiRequestsPerMinute, safetyLimits };
		});
	}

	async throttle(kind: 'http' | 'uploads', limit: number, now = Date.now()) {
		return this.storage.transaction(async (txn) => {
			const timestamps = z.array(z.number()).parse((await txn.get(`burst:${kind}`)) ?? []).filter((time) => time > now - 60_000);
			if (timestamps.length >= limit) {
				return limitError(`${kind}RequestsPerMinute`, limit, timestamps.length, new Date(timestamps[0] + 60_000).toISOString(), now);
			}
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
