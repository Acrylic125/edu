import { describe, expect, it } from 'vitest';
import { RunBudget } from './run-budget';
import { safetyLimits } from './plans';

describe('aggregate AI safety budget', () => {
	it('bounds calls including repair and background work', () => {
		const budget = new RunBudget();
		for (let i = 0; i < safetyLimits.modelCallsPerRun; i++) {
			const reserved = budget.reserve('input');
			budget.settle(reserved, 10);
		}
		expect(() => budget.reserve('summary')).toThrow('call budget');
	});
	it('retains conservative output reservations for interrupted calls', () => {
		const budget = new RunBudget();
		for (let i = 0; i < 4; i++) expect(budget.reserve('input', 20_000)).toBe(4096);
		expect(() => budget.reserve('retry')).toThrow('output budget');
	});
	it('rejects oversized context before reserving a provider call', () => {
		const budget = new RunBudget();
		expect(() => budget.reserve('x'.repeat(safetyLimits.inputCharactersPerCall + 1))).toThrow('context');
		expect(budget.reserve('small')).toBe(4096);
	});
});
