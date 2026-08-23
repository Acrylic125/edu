import { z } from "zod";

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
});

export type TopicUpdate = z.infer<typeof TopicUpdateSchema>;
export type ProposedUpdate = z.infer<typeof ProposedUpdateSchema>;

export function parseJsonFromLlm<T extends z.ZodType>(
	schema: T,
	response: string,
	fallback: z.infer<T>,
) {
	const jsonMatch = response.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return fallback;
	}

	try {
		const result = schema.safeParse(JSON.parse(jsonMatch[0]));
		if (result.success) {
			return result.data;
		}
	} catch {
		return fallback;
	}

	return fallback;
}
