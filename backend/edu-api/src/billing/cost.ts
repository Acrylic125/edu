import { z } from 'zod';

export const PlanSchema = z.enum(['free', 'pro']);

// A turn is the billing boundary: tool calls, image processing, and other internal work
// stay inside one predictable charge instead of exposing implementation details to users.
export const creditCosts = {
	turn: 1,
	imageUpload: 1,
	pdfPage: 1,
} as const;

// Both windows are enforced together so short bursts and sustained use share one unit.
// Limits live beside costs to keep the complete credit policy in one authoritative file.
export const plans = {
	free: {
		name: 'Free',
		creditsPer5Hours: 100,
		creditsPerWeek: 1_000,
	},
	pro: {
		name: 'Pro',
		creditsPer5Hours: 1_000,
		creditsPerWeek: 15_000,
	},
} satisfies Record<z.infer<typeof PlanSchema>, {
	name: string;
	creditsPer5Hours: number;
	creditsPerWeek: number;
}>;
