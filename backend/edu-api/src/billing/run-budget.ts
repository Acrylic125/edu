import { safetyLimits } from './plans';

export class RunBudget {
	private calls = 0;
	private reservedOutput = 0;

	reserve(input: string, requestedTokens = safetyLimits.outputTokensPerCall) {
		if (input.length > safetyLimits.inputCharactersPerCall) throw new Error('Request context is too large. Start a new topic or use fewer attachments.');
		if (this.calls >= safetyLimits.modelCallsPerRun) throw new Error('AI call budget exhausted');
		const maxTokens = Math.min(requestedTokens, safetyLimits.outputTokensPerCall, safetyLimits.outputTokensPerRun - this.reservedOutput);
		if (maxTokens <= 0) throw new Error('AI output budget exhausted');
		this.calls += 1;
		this.reservedOutput += maxTokens;
		return maxTokens;
	}

	settle(reservedTokens: number, outputTokens: number) {
		this.reservedOutput += outputTokens - reservedTokens;
	}
}
