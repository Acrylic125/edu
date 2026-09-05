import type { TopicPlanChapter } from '../agents/parsed-output';

function escapeTableCell(value: string) {
	return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

export function formatTopicPlanMarkdown(chapters: TopicPlanChapter[]) {
	const rows = chapters.map((chapter) => {
		return `| ${escapeTableCell(chapter.chapter)} | ${escapeTableCell(chapter.whatIsCovered)} |`;
	});

	return ["Here's the plan", '', '| Chapter | What is covered |', '| --- | --- |', ...rows].join('\n');
}
