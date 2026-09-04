import { eq } from "drizzle-orm";

import type { Db } from "../../db/client";
import { agentRun, agentStep, modelUsage } from "../../db/schema";
import { nanoid } from "nanoid";
import { callLlm, streamLlm, withLlmTrace, type LlmEnv } from "./llm";
import { drainWordChunks, flushWords } from "../chat/word-buffer";
import type { AgentImage } from "../assets/load";

const PROVIDER = "openrouter";

const INPUT_PRICE_MICROS = 150;
const OUTPUT_PRICE_MICROS = 600;

export class AgentRunner {
	private db: Db;
	private llmEnv: LlmEnv;
	readonly runId: string;
	private topicId: string | null;
	private signal: AbortSignal | undefined;
	private sequence = 0;

	private onProgress: ((label: string) => void) | undefined;
	private images: AgentImage[];

	constructor(options: {
		db: Db;
		llmEnv: LlmEnv;
		runId: string;
		topicId: string | null;
		signal?: AbortSignal;
		onProgress?: (label: string) => void;
		images?: AgentImage[];
	}) {
		this.db = options.db;
		this.llmEnv = options.llmEnv;
		this.runId = options.runId;
		this.topicId = options.topicId;
		this.signal = options.signal;
		this.onProgress = options.onProgress;
		this.images = options.images ?? [];
	}

	announce(label: string) {
		if (!this.onProgress) {
			return;
		}
		this.onProgress(label);
	}

	withTrace<T>(fn: () => Promise<T>) {
		return withLlmTrace(this.llmEnv, this.runId, fn);
	}

	private async nextSequence() {
		this.sequence += 1;
		return this.sequence;
	}

	async recordStep(params: {
		type: string;
		name: string;
		input?: object | null;
		output?: object | null;
		error?: string;
	}) {
		const stepId = `step_${nanoid()}`;
		if (!this.topicId) {
			return stepId;
		}

		const sequence = await this.nextSequence();

		await this.db.insert(agentStep).values({
			id: stepId,
			runId: this.runId,
			sequence,
			type: params.type,
			name: params.name,
			input: params.input ?? null,
			output: params.output ?? null,
			error: params.error ?? null,
			createdAt: new Date(),
		});

		return stepId;
	}

	async recordRoutingStep(name: string, input: object, output: object) {
		return this.recordStep({ type: "routing", name, input, output });
	}

	async llmCall(params: {
		name: string;
		stepType?: string;
		instructions: string;
		input: string;
		maxTokens?: number;
	}) {
		const stepId = await this.recordStep({
			type: params.stepType ?? "llm",
			name: params.name,
			input: { instructions: params.instructions, input: params.input },
		});

		try {
			const result = await callLlm(this.llmEnv, {
				instructions: params.instructions,
				input: params.input,
				images: this.images,
				maxTokens: params.maxTokens,
				signal: this.signal,
			});

			await this.db
				.update(agentStep)
				.set({ output: { text: result.text } })
				.where(eq(agentStep.id, stepId));

			if (this.topicId) {
				await this.recordModelUsage(stepId, result);
			}

			return result.text;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "LLM call failed";
			await this.db
				.update(agentStep)
				.set({ error: errorMessage })
				.where(eq(agentStep.id, stepId));
			throw error;
		}
	}

	async llmStream(params: {
		name: string;
		stepType?: string;
		instructions: string;
		input: string;
		onChunk: (text: string) => void;
		maxTokens?: number;
	}) {
		const stepId = await this.recordStep({
			type: params.stepType ?? "llm",
			name: params.name,
			input: { instructions: params.instructions, input: params.input },
		});

		try {
			let pending = "";
			const result = await streamLlm(this.llmEnv, {
				instructions: params.instructions,
				input: params.input,
				images: this.images,
				maxTokens: params.maxTokens,
				signal: this.signal,
				onDelta: async (delta) => {
					pending = await drainWordChunks(
						pending,
						delta,
						params.onChunk,
					);
				},
			});

			const remainder = flushWords(pending);
			if (remainder.flush !== "") {
				params.onChunk(remainder.flush);
			}

			await this.db
				.update(agentStep)
				.set({ output: { text: result.text } })
				.where(eq(agentStep.id, stepId));

			if (this.topicId) {
				await this.recordModelUsage(stepId, result);
			}

			return result.text;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "LLM call failed";
			await this.db
				.update(agentStep)
				.set({ error: errorMessage })
				.where(eq(agentStep.id, stepId));
			throw error;
		}
	}

	private async recordModelUsage(
		stepId: string,
		result: Awaited<ReturnType<typeof callLlm>>,
	) {
		const costMicros =
			result.inputTokens * INPUT_PRICE_MICROS +
			result.outputTokens * OUTPUT_PRICE_MICROS;

		await this.db.insert(modelUsage).values({
			id: `usage_${nanoid()}`,
			runId: this.runId,
			stepId,
			provider: PROVIDER,
			model: result.model,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			cachedInputTokens: result.cachedInputTokens,
			reasoningTokens: result.reasoningTokens,
			inputPriceMicros: INPUT_PRICE_MICROS,
			outputPriceMicros: OUTPUT_PRICE_MICROS,
			costMicros,
			createdAt: new Date(),
		});
	}

	async complete(status: "completed" | "failed" | "cancelled" = "completed") {
		if (!this.topicId) {
			return;
		}

		await this.db
			.update(agentRun)
			.set({ status, completedAt: new Date() })
			.where(eq(agentRun.id, this.runId));
	}

	async fail(error: Error | string) {
		if (!this.topicId) {
			return;
		}

		await this.db
			.update(agentRun)
			.set({
				status: "failed",
				completedAt: new Date(),
			})
			.where(eq(agentRun.id, this.runId));

		const errorMessage =
			error instanceof Error ? error.message : String(error);

		await this.recordStep({
			type: "error",
			name: "run_failure",
			error: errorMessage,
		});
	}
}

export async function createAgentRun(
	db: Db,
	llmEnv: LlmEnv,
	params: {
		runId?: string;
		topicId: string | null;
		userMessageId: string;
		intent: string | null;
		signal?: AbortSignal;
		onProgress?: (label: string) => void;
		images?: AgentImage[];
	},
) {
	const runId = params.runId ?? `run_${nanoid()}`;

	if (params.topicId) {
		await db.insert(agentRun).values({
			id: runId,
			topicId: params.topicId,
			userMessageId: params.userMessageId,
			intent: params.intent,
			status: "running",
			createdAt: new Date(),
		});
	}

	return new AgentRunner({
		db,
		llmEnv,
		runId,
		topicId: params.topicId,
		signal: params.signal,
		onProgress: params.onProgress,
		images: params.images,
	});
}

export async function getRunCostMicros(db: Db, runId: string) {
	const rows = await db
		.select({ costMicros: modelUsage.costMicros })
		.from(modelUsage)
		.where(eq(modelUsage.runId, runId));

	return rows.reduce((sum, row) => sum + row.costMicros, 0);
}
