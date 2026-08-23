import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	VerificationResultSchema,
} from "../agents/parsed-output";

export async function verifySolution(
	runner: AgentRunner,
	params: {
		question: string;
		solution: string;
		domain: string;
	},
) {
	if (params.domain !== "STEM") {
		return {
			correct: false,
			partiallyCorrect: false,
			feedback: "Currently supports STEM subjects.",
			errors: ["Unsupported domain"],
		};
	}

	const instructions = [
		"You are an independent solution verifier for STEM problems.",
		"Analyze the student's solution step by step.",
		'Respond in JSON: {"correct": boolean, "partiallyCorrect": boolean, "feedback": string, "errors": string[]}',
		"Be rigorous. Do not trust the solution without checking each step.",
	].join("\n");

	const input = [
		`Question: ${params.question}`,
		`Student solution: ${params.solution}`,
	].join("\n\n");

	try {
		const response = await runner.llmCall({
			name: "verify_solution",
			stepType: "verification",
			instructions,
			input,
		});

		return parseJsonFromLlm(VerificationResultSchema, response, {
			correct: false,
			partiallyCorrect: false,
			feedback: response,
			errors: [],
		});
	} catch (error) {
		return {
			correct: false,
			partiallyCorrect: false,
			feedback: "Verification could not be completed.",
			errors: [
				error instanceof Error ? error.message : "Verification failed",
			],
		};
	}
}

export async function determineDomain(runner: AgentRunner, summary: string) {
	const response = await runner.llmCall({
		name: "determine_domain",
		stepType: "routing",
		instructions:
			"Classify the subject domain as exactly one of: STEM, Humanities, Other. Respond with only the domain name.",
		input: summary,
	});

	const normalized = response.trim().toUpperCase();
	if (normalized.includes("STEM")) {
		return "STEM";
	}
	if (normalized.includes("HUMANITIES")) {
		return "Humanities";
	}
	return "Other";
}
