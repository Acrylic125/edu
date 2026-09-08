// Safety ceilings apply to both plans and include background work and retries.
export const safetyLimits = {
	httpRequestsPerMinute: 120,
	webSocketConnections: 5,
	uploadRequestsPerMinute: 10,
	imageBytes: 256 * 1024,
	pdfBytes: 20 * 1024 * 1024,
	pdfPagesPerFile: 500,
	attachmentsPerMessage: 5,
	uploadExpiresMs: 60 * 60 * 1000,
	runTimeoutMs: 120_000,
	modelCallsPerRun: 12,
	inputCharactersPerCall: 120_000,
	outputTokensPerCall: 4096,
	outputTokensPerRun: 16_384,
};
