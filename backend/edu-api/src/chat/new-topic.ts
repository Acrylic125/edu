import type { TopicPlanItem, TopicPlanStep } from '../messages/schema';

function withoutNewCommand(message: string) {
	let content = message.trim();
	while (content.toLowerCase().startsWith('/new')) {
		const separator = content[4];
		if (separator !== undefined && separator.trim() !== '') break;
		content = content.slice(4).trim();
	}
	return content;
}

export function extractSuppliedPlanLines(message: string) {
	const sourceLines = withoutNewCommand(message)
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (sourceLines.length < 4 || sourceLines.length > 32 || sourceLines.some((line) => line.length > 120)) return null;
	return { sourceLines };
}

function formatSection(item: Extract<TopicPlanItem, { role: 'section' }>) {
	const title = item.title.trim();
	if (item.depth === 0) return `- **${title}**`;
	return `${'  '.repeat(item.depth)}- ${title}`;
}

function formatPlan(items: TopicPlanItem[], intro: string) {
	const blocks: string[] = [intro];
	let sections: string[] = [];

	function flushSections() {
		if (sections.length === 0) return;
		blocks.push(sections.join('\n'));
		sections = [];
	}

	for (const item of items) {
		if (item.role === 'section') {
			sections.push(formatSection(item));
			continue;
		}

		flushSections();
		if (item.role === 'header') {
			blocks.push(`### ${item.title}`);
			continue;
		}
		blocks.push(`**${item.title}**`);
	}
	flushSections();
	return blocks.join('\n\n');
}

function formatStructuredPlan(steps: TopicPlanStep[]) {
	const lines = ["Here's the plan", ''];
	for (const step of steps) {
		const depth = step.parent === null ? 0 : 1;
		lines.push(`${'  '.repeat(depth)}- **${step.label}** — ${step.summary}`);
	}
	return lines.join('\n');
}

export function formatTopicPlanMarkdown(plan: TopicPlanItem[] | TopicPlanStep[], reflectsLearnerPlan = false) {
	if (plan.length > 0 && 'label' in plan[0]) return formatStructuredPlan(plan as TopicPlanStep[]);
	if (reflectsLearnerPlan) return formatPlan(plan as TopicPlanItem[], "I'll use the plan you provided:");
	return formatPlan(plan as TopicPlanItem[], "Here's the plan");
}
