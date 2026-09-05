import type { AgentContext } from "./context";
import { formatMessagesForModel } from "./context";
import type { AgentRunner } from "../agents/runner";
import type { PersistedTopicMessage } from "../messages/schema";
import { partsToText } from "../messages/parts";

export type IntentType =
	| "new-topic"
	| "update-topic"
	| "answer"
	| "new-question"
	| "chat"
	| "clarify";

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
	{ prefix: "/topic ", type: "chat" },
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
	if (trimmed === "/topic") return { type: "chat", message: "" };

	return null;
}

const NEW_QUESTION_RE =
	/\b(new\s*qns?|new\s*qn|new\s*questions?|another\s+question|similar\s+question|try\s+(a\s+)?similar|quiz\s+me|test\s+me)\b/i;

const NEXT_WITHIN_TOPIC_RE =
	/\b((what'?s|what is|whats)\s+(the\s+)?next\s+(topic|section|unit|part|chapter|lesson|focus)|next\s+(topic|section|unit|part|chapter|lesson|focus)|(move on|continue)\s+(to\s+)?(the\s+)?next)\b/i;

const DIAGRAM_REQUEST_RE =
	/\b(diagram|visuali[sz](e|ation)|state\s*machine|flowchart|graph|process\s+map)\b/i;

export function looksLikeDiagramRequest(message: string) {
	return DIAGRAM_REQUEST_RE.test(message.trim());
}

export function lastPracticeQuestion(
	messages: PersistedTopicMessage[],
): string | null {
	return practiceQuestionHistory(messages)[0] ?? null;
}

export function practiceQuestionHistory(
	messages: PersistedTopicMessage[],
	limit = 8,
) {
	const questions: string[] = [];
	for (let i = messages.length - 1; i >= 0 && questions.length < limit; i--) {
		const message = messages[i];
		if (!message || message.role !== "agent") {
			continue;
		}
		if (message.parts.some((part) => part.type === "proposal")) {
			continue;
		}
		const text = partsToText(
			message.parts.filter(
				(part) => part.type === "text" || part.type === "options",
			),
		).trim();
		if (text === "") {
			continue;
		}
		if (looksLikePracticeQuestion(text)) {
			questions.push(text);
		}
	}
	return questions;
}

function looksLikePracticeQuestion(text: string) {
	if (/practice question/i.test(text)) {
		return true;
	}
	if (/\?/.test(text)) {
		return true;
	}
	if (/\b(compute|evaluate|simplify|find|let )\b/i.test(text)) {
		return true;
	}
	return false;
}

export function looksLikeStudentWork(text: string) {
	const trimmed = text.trim();
	if (trimmed === "") {
		return false;
	}
	const numberedJudgements = trimmed.match(
		/(?:^|\n)\s*\d+\s*[.),:-]\s*(?:true|false|valid|invalid)\b/gi,
	);
	if (numberedJudgements && numberedJudgements.length >= 2) {
		return true;
	}
	const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
	const digits = (trimmed.match(/\d/g) ?? []).length;
	if (digits >= 2 && letters <= 16) {
		return true;
	}
	const lines = trimmed.split(/\n/).filter((line) => line.trim() !== "");
	if (lines.length >= 2) {
		const numericLines = lines.every((line) =>
			/^[\d\s.,+\-eE]+$/.test(line.trim()),
		);
		if (numericLines) {
			return true;
		}
	}
	return false;
}

export function looksLikeNextWithinTopic(message: string) {
	return NEXT_WITHIN_TOPIC_RE.test(message.trim());
}

export function deduceObviousIntent(
	message: string,
	context: AgentContext,
): DeducedIntent | null {
	const trimmed = message.trim();
	if (NEW_QUESTION_RE.test(trimmed)) {
		return { type: "new-question", message };
	}
	if (looksLikeDiagramRequest(trimmed)) {
		return { type: "chat", message };
	}
	const lastQuestion = lastPracticeQuestion(context.recentMessages);
	if (lastQuestion && looksLikeStudentWork(trimmed)) {
		return { type: "answer", message };
	}
	// "What's next?" is not an obvious command — slash /update applies immediately;
	// natural language should propose or chat, not mutate the plan.
	return null;
}

export async function inferFromRaw(
	message: string,
	context: AgentContext,
	runner: AgentRunner,
) {
	const parts = [
		"Classify the user's intent into exactly one of: new-topic, update-topic, answer, new-question, chat.",
		"",
		"Definitions:",
		"- new-topic: user wants to abandon the current subject and start a different subject (e.g. switch from Linear Algebra to Chemistry)",
		"- update-topic: user wants to change focus within the current subject, advance to the next section/unit, or revise the learning plan",
		"- answer: user is submitting a solution to be graded",
		"- new-question: user wants a practice question or quiz",
		"- chat: user wants an explanation or discussion, not grading",
		"",
		"Execute when the intent is clear. Use chat only when the message is discussion or truly ambiguous.",
		"If they ask for a new, similar, or another question, classify new-question.",
		"If the last assistant message was a practice question and they sent numbers, a matrix, or working, classify answer.",
		'If they ask "what\'s next", "next topic", "next section", or similar while a topic is active, classify update-topic — not new-topic.',
		"",
	];
	if (context.topic) {
		parts.push(`Topic: ${context.topic.title}`);
		parts.push(`Summary: ${context.topic.summary}`);
	}
	if (context.topic?.part) {
		parts.push(`Current focus: ${context.topic.part}`);
	}
	if (context.recentMessages.length > 0) {
		parts.push("Recent conversation:");
		parts.push(formatMessagesForModel(context.recentMessages));
	}
	const systemContext = parts.join("\n");

	let response: string;
	try {
		response = await runner.llmCall({
			name: "infer_intent",
			stepType: "routing",
			maxTokens: 16,
			instructions: systemContext,
			input: message,
		});
	} catch (error) {
		console.error("Intent inference failed; asking for clarification:", error);
		return { type: "clarify" as const, message };
	}

	const normalized = response.trim().toLowerCase();

	if (normalized.includes("new-topic") || normalized.includes("new_topic")) {
		if (context.topic) {
			return { type: "update-topic" as const, message };
		}
		return { type: "new-topic" as const, message };
	}
	if (
		normalized.includes("update-topic") ||
		normalized.includes("update_topic")
	) {
		return { type: "update-topic" as const, message };
	}
	if (
		normalized.includes("new-question") ||
		normalized.includes("new_question")
	) {
		return { type: "new-question" as const, message };
	}
	if (normalized.includes("answer")) {
		return { type: "answer" as const, message };
	}
	if (normalized.includes("chat")) {
		return { type: "chat" as const, message };
	}

	return { type: "clarify" as const, message };
}
