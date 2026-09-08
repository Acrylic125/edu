import { MAX_TOPIC_PLAN_STEPS, type TopicPlanItem, type TopicPlanStep } from '../messages/schema';

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
		.map((line) => line.replace(/\s+$/, ''))
		.filter((line) => line.trim().length > 0);
	if (sourceLines.length < 4 || sourceLines.length > MAX_TOPIC_PLAN_STEPS || sourceLines.some((line) => line.length > 120)) return null;
	return { sourceLines };
}

function cleanOutlineLabel(line: string) {
	return line.replace(/^(?:[-*+]|(?:[IVXLCDM]+|[A-Z]|\d+)[.)])\s+/, '').trim();
}

function outlineDepth(source: string) {
	const leading = source.match(/^\s*/)?.[0] ?? '';
	const spaces = leading.replace(/\t/g, '  ').length;
	if (/^\s*[-*+]\s+/.test(source)) return Math.max(1, Math.floor(spaces / 2));
	return Math.floor(spaces / 2);
}

export function structuredPlanFromSuppliedLines(sourceLines: string[]) {
	const steps = sourceLines.map((source, index) => {
		return {
			index,
			depth: outlineDepth(source),
			label: cleanOutlineLabel(source),
		};
	});
	return steps.map((step) => {
		let parent: string | null = null;
		for (let index = step.index - 1; index >= 0; index -= 1) {
			const candidate = steps[index];
			if (candidate && candidate.depth < step.depth) {
				parent = `step-${candidate.index + 1}`;
				break;
			}
		}
		return {
			id: `step-${step.index + 1}`,
			label: step.label,
			summary: step.label,
			parent,
		};
	});
}

export function learningStepsFromPlan(steps: TopicPlanStep[], title: string) {
	if (steps.length <= 1) return steps;
	const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const titleStep = steps.find((step) => {
		if (step.parent !== null) return false;
		return step.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalizedTitle;
	});
	if (!titleStep) return steps;
	return steps
		.filter((step) => step.id !== titleStep.id)
		.map((step) => {
			if (step.parent !== titleStep.id) return step;
			return { ...step, parent: null };
		});
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
