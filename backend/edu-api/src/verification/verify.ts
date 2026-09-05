import type { AgentRunner } from '../agents/runner';
import { parseJsonFromLlm, VerificationResultSchema } from '../agents/parsed-output';

export async function verifySolution(
	runner: AgentRunner,
	params: {
		question: string;
		solution: string;
	},
) {
	const instructions = [
		'Verify the STEM solution independently.',
		"Analyze the student's solution step by step.",
		'Respond in JSON: {"correct": boolean, "partiallyCorrect": boolean, "feedback": string, "errors": string[]}',
		'Be rigorous. Do not trust the solution without checking each step.',
	].join('\n');

	const input = [`Question: ${params.question}`, `Student solution: ${params.solution}`].join('\n\n');

	try {
		const response = await runner.llmCall({
			name: 'verify_solution',
			stepType: 'verification',
			instructions,
			input,
		});

		const parsed = parseJsonFromLlm(VerificationResultSchema, response);
		if (!parsed) {
			return {
				status: 'unavailable',
				feedback: 'Verification could not be completed.',
				errors: ['Model did not return valid verification JSON'],
			};
		}
		return { status: 'verified', ...parsed };
	} catch (error) {
		return {
			status: 'unavailable',
			feedback: 'Verification could not be completed.',
			errors: [error instanceof Error ? error.message : 'Verification failed'],
		};
	}
}
