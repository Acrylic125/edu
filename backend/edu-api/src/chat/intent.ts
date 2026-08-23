import type { AgentContext } from "./context";
import type { AgentRunner } from "../agents/runner";

export type IntentType =
	| "new-topic"
	| "update-topic"
	| "answer"
	| "new-question";

export type DeducedIntent = {
	type: IntentType;
	message: string;
};

export const EXPLICIT_COMMANDS: Array<{
	prefix: string;
	type: IntentType;
}> = [
	{ prefix: "/new ", type: "new-topic" },
	{ prefix: "/new\n", type: "new-topic" },
	{ prefix: "/update ", type: "update-topic" },
	{ prefix: "/ans ", type: "answer" },
	{ prefix: "/new-qns ", type: "new-question" },
	{ prefix: "/topic ", type: "answer" },
];

export function parseExplicitCommand(message: string): DeducedIntent | null {
	const trimmed = message.trim();

	for (const cmd of EXPLICIT_COMMANDS) {
		if (trimmed === cmd.prefix.trim()) {
			return { type: cmd.type, message: "" };
		}
		if (trimmed.startsWith(cmd.prefix)) {
			return {
				type: cmd.type,
				message: trimmed.slice(cmd.prefix.length).trim(),
			};
		}
	}

	if (trimmed === "/new") return { type: "new-topic", message: "" };
	if (trimmed === "/update") return { type: "update-topic", message: "" };
	if (trimmed === "/ans") return { type: "answer", message: "" };
	if (trimmed === "/new-qns") return { type: "new-question", message: "" };
	if (trimmed === "/topic") return { type: "answer", message: "" };

	return null;
}

export async function deduceIntent(
	message: string,
	context: AgentContext,
	runner: AgentRunner,
) {
	const explicit = parseExplicitCommand(message);
	if (explicit) {
		await runner.recordRoutingStep("deduce_intent", { message }, explicit);
		return explicit;
	}

	if (!context.topic) {
		const intent: DeducedIntent = { type: "new-topic", message };
		await runner.recordRoutingStep("deduce_intent", { message }, intent);
		return intent;
	}

	const intent = await inferFromRaw(message, context, runner);
	await runner.recordRoutingStep("deduce_intent", { message }, intent);
	return intent;
}

async function inferFromRaw(
	message: string,
	context: AgentContext,
	runner: AgentRunner,
) {
	const parts = [
		"Classify the user's intent into exactly one of: new-topic, update-topic, answer, new-question.",
		"",
		"Definitions:",
		"- new-topic: user wants to start learning a new subject",
		"- update-topic: user wants to change their learning plan or topic focus",
		"- answer: user is asking a question or submitting a solution to be evaluated",
		"- new-question: user wants a practice question or quiz",
		"",
	];
	if (context.topic) {
		parts.push(`Topic: ${context.topic.title}`);
	}
	if (context.topic?.part) {
		parts.push(`Current focus: ${context.topic.part}`);
	}
	const systemContext = parts.join("\n");

	const response = await runner.llmCall({
		name: "infer_intent",
		stepType: "routing",
		instructions: systemContext,
		input: message,
	});

	const normalized = response.trim().toLowerCase();

	if (normalized.includes("new-topic") || normalized.includes("new_topic")) {
		return { type: "new-topic", message };
	}
	if (
		normalized.includes("update-topic") ||
		normalized.includes("update_topic")
	) {
		return { type: "update-topic", message };
	}
	if (
		normalized.includes("new-question") ||
		normalized.includes("new_question")
	) {
		return { type: "new-question", message };
	}

	return { type: "answer", message };
}
