import { describe, expect, it } from 'vitest';
import { parseExplicitCommand } from './intent';

describe('parseExplicitCommand', () => {
	it('parses /new command', () => {
		expect(parseExplicitCommand('/new Binary Search')).toEqual({
			type: 'new-topic',
			message: 'Binary Search',
		});
	});

	it('parses bare /new', () => {
		expect(parseExplicitCommand('/new')).toEqual({
			type: 'new-topic',
			message: '',
		});
	});

	it('parses /update command', () => {
		expect(parseExplicitCommand('/update focus on complexity')).toEqual({
			type: 'update-topic',
			message: 'focus on complexity',
		});
	});

	it('parses /ans command', () => {
		expect(parseExplicitCommand('/ans x = 5')).toEqual({
			type: 'answer',
			message: 'x = 5',
		});
	});

	it('parses /new-qns command', () => {
		expect(parseExplicitCommand('/new-qns harder')).toEqual({
			type: 'new-question',
			message: 'harder',
		});
	});

	it('maps /topic to chat', () => {
		expect(parseExplicitCommand("/topic explain Prim's")).toEqual({
			type: 'chat',
			message: "explain Prim's",
		});
	});

	it('returns null for natural language', () => {
		expect(parseExplicitCommand('Why is this O(n log n)?')).toBeNull();
	});
});
