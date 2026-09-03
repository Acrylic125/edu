import type { AgentRunner } from "../agents/runner";
import {
	parseJsonFromLlm,
	TopicPlanChaptersSchema,
	type TopicPlanChapter,
} from "../agents/parsed-output";
import { buildSystemContext, type AgentContext } from "./context";
import { optionLabel } from "./option-label";
import { optionsPart, textPart } from "../messages/parts";
import type { MessagePart } from "../messages/schema";

function escapeTableCell(value: string) {
	return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export function formatTopicPlanMarkdown(chapters: TopicPlanChapter[]) {
	const rows = chapters.map((chapter) => {
		return `| ${escapeTableCell(chapter.chapter)} | ${escapeTableCell(chapter.whatIsCovered)} |`;
	});

	return [
		"Here's the plan",
		"",
		"| Chapter | What is covered |",
		"| --- | --- |",
		...rows,
	].join("\n");
}

export async function executeNewTopicContinuation(
	runner: AgentRunner,
	context: AgentContext,
	parsed: { title: string; summary: string; part: string },
	onDelta: (text: string) => void,
) {
	const generated = await runner.llmCall({
		name: "generate_topic_plan",
		instructions: [
			buildSystemContext(context),
			"",
			"Break this topic into a learning plan of chapters.",
			"Respond with ONLY a JSON array of objects:",
			'[{"chapter": string, "whatIsCovered": string}]',
			"chapter: short chapter title.",
			"whatIsCovered: one concise sentence of what the student learns.",
			"Include 3-8 chapters covering the topic from basics to more advanced.",
			"Do not write a welcome message or prose outside the JSON.",
		].join("\n"),
		input: [
			`Title: ${parsed.title}`,
			`Summary: ${parsed.summary}`,
			`Starting focus: ${parsed.part}`,
		].join("\n"),
	});

	const chapters = parseJsonFromLlm(TopicPlanChaptersSchema, generated);
	if (!chapters) {
		const fallback = [
			"Here's the plan",
			"",
			"| Chapter | What is covered |",
			"| --- | --- |",
			`| ${escapeTableCell(parsed.part)} | ${escapeTableCell(parsed.summary)} |`,
		].join("\n");
		onDelta(fallback);
		return {
			parts: [
				textPart(fallback),
				optionsPart([
					optionLabel("What's", parsed.title) + "?",
					optionLabel("Test me on", parsed.title),
				]),
			],
		};
	}

	const planText = formatTopicPlanMarkdown(chapters);
	onDelta(planText);

	const parts: MessagePart[] = [
		textPart(planText),
		optionsPart([
			optionLabel("What's", parsed.title) + "?",
			optionLabel("Test me on", parsed.title),
		]),
	];

	return { parts };
}
