import { z } from 'zod';

export const PlanSchema = z.enum(['free', 'pro']);

// UTC calendar periods; changing a plan never resets its counters.
export const plans = {
	free: {
		name: 'Free',
		aiRequestsPerDay: 20,
		aiRequestsPerMonth: 100,
		aiRequestsPerMinute: 5,
		uploadsPerMonth: 10,
		pdfPagesPerMonth: 100,
		storageBytes: 100 * 1024 * 1024,
	},
	pro: {
		name: 'Pro',
		aiRequestsPerDay: 200,
		aiRequestsPerMonth: 2000,
		aiRequestsPerMinute: 20,
		uploadsPerMonth: 200,
		pdfPagesPerMonth: 5000,
		storageBytes: 2 * 1024 * 1024 * 1024,
	},
} satisfies Record<z.infer<typeof PlanSchema>, {
	name: string;
	aiRequestsPerDay: number;
	aiRequestsPerMonth: number;
	aiRequestsPerMinute: number;
	uploadsPerMonth: number;
	pdfPagesPerMonth: number;
	storageBytes: number;
}>;

// Safety ceilings apply to both plans and include background work and retries.
export const safetyLimits = {
	httpRequestsPerMinute: 120,
	webSocketConnections: 5,
	uploadRequestsPerMinute: 10,
	imageBytes: 256 * 1024,
	pdfBytes: 20 * 1024 * 1024,
	pdfPagesPerFile: 500,
	attachmentsPerMessage: 5,
	uploadExpiresMs: 60 * 60 * 1000,
	runTimeoutMs: 120_000,
	modelCallsPerRun: 12,
	inputCharactersPerCall: 120_000,
	outputTokensPerCall: 4096,
	outputTokensPerRun: 16_384,
};
