import { describe, expect, it } from 'vitest';
import { extractSuppliedPlanLines, formatTopicPlanMarkdown, structuredPlanFromSuppliedLines } from './new-topic';

describe('formatTopicPlanMarkdown', () => {
	it('renders a generated plan as a list', () => {
		const markdown = formatTopicPlanMarkdown([
			{ title: 'Basics', role: 'section', depth: 0 },
			{ title: 'Product rule', role: 'section', depth: 0 },
		]);

		expect(markdown).toBe(["Here's the plan", '', '- **Basics**', '- **Product rule**'].join('\n'));
	});

	it('renders the semantic structure supplied by the Tutor', () => {
		const markdown = formatTopicPlanMarkdown(
			[
				{ sourceIndex: 0, title: 'CS2100', role: 'context' },
				{
					sourceIndex: 1,
					title: 'Lecture #3: Data Representation and Number Systems',
					role: 'header',
				},
				{ sourceIndex: 2, title: 'Data Representation', role: 'section', depth: 0 },
				{
					sourceIndex: 3,
					title: 'Decimal to Binary Conversion',
					role: 'section',
					depth: 0,
				},
				{
					sourceIndex: 4,
					title: 'Repeated Division-by-2',
					role: 'section',
					depth: 1,
				},
				{
					sourceIndex: 5,
					title: 'Worked Examples',
					role: 'section',
					depth: 2,
				},
			],
			true,
		);

		expect(markdown).toContain('**CS2100**');
		expect(markdown).toContain('### Lecture #3: Data Representation and Number Systems');
		expect(markdown).toContain('- **Data Representation**');
		expect(markdown).toContain('- **Decimal to Binary Conversion**');
		expect(markdown).toContain('  - Repeated Division-by-2');
		expect(markdown).toContain('    - Worked Examples');
		expect(markdown).not.toContain('| Section |');
		expect(markdown).not.toContain('Overview');
	});
});

describe('explicit topic plans', () => {
	it('preserves every nonblank source line without interpreting its format', () => {
		expect(
			extractSuppliedPlanLines(`/new /new CS2100

Lecture #3\tData Representation and Number Systems
Data Representation
5.1 Repeated Division-by-2
ASCII Code`),
		).toEqual({
			sourceLines: [
				'CS2100',
				'Lecture #3\tData Representation and Number Systems',
				'Data Representation',
				'5.1 Repeated Division-by-2',
				'ASCII Code',
			],
		});
	});

	it('does not treat a normal multiline request as an explicit plan', () => {
		expect(extractSuppliedPlanLines('/new Explain vectors\nwith examples')).toBeNull();
	});

	it('treats bullets as children of the preceding heading', () => {
		const plan = structuredPlanFromSuppliedLines([
			'Arrays & Lists',
			'- Array Storage',
			'- Linked Lists',
			'Trees & Graphs',
			'- Tree Traversal',
		]);
		expect(plan).toMatchObject([
			{ id: 'step-1', label: 'Arrays & Lists', parent: null },
			{ id: 'step-2', label: 'Array Storage', parent: 'step-1' },
			{ id: 'step-3', label: 'Linked Lists', parent: 'step-1' },
			{ id: 'step-4', label: 'Trees & Graphs', parent: null },
			{ id: 'step-5', label: 'Tree Traversal', parent: 'step-4' },
		]);
	});
});
