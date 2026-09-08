import { z } from "zod";
import { TopicPlanSchema } from "../messages/schema";

export const TopicGenerationSchema = z.object({
	title: z.string(),
	summary: z.string(),
	part: z.string(),
});

export const QuestionIdentificationSchema = z.object({
	found: z.boolean(),
	question: z.string().default(""),
	candidates: z.array(z.string()).default([]),
});

export const VerificationResultSchema = z.object({
	correct: z.boolean(),
	partiallyCorrect: z.boolean(),
	feedback: z.string(),
	errors: z.array(z.string()),
});

export const ProposedUpdateSchema = z.object({
	shouldUpdate: z.boolean(),
	title: z.string().optional(),
	summary: z.string().optional(),
	part: z.string().optional(),
	explanation: z.string().optional(),
});

export const TopicUpdateSchema = z.object({
	title: z.string().optional(),
	summary: z.string().optional(),
	part: z.string().optional(),
	plan: TopicPlanSchema.optional(),
});

export type TopicUpdate = z.infer<typeof TopicUpdateSchema>;
export type ProposedUpdate = z.infer<typeof ProposedUpdateSchema>;

export function parseJsonFromLlm<T extends z.ZodType>(
	schema: T,
	response: string,
) {
	// Prefer array candidates first so list responses parse as a whole,
	// not as the first nested object inside that list.
	const candidates = [
		response.match(/\[[\s\S]*\]/)?.[0],
		response.match(/\{[\s\S]*\}/)?.[0],
	];

	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		try {
			const result = schema.safeParse(JSON.parse(candidate));
			if (result.success) {
				return result.data;
			}
		} catch {
			continue;
		}
	}

	return null;
}
