import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

export const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type LlmEnv = {
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
};

export type LlmCallParams = {
	instructions: string;
	input: string;
	images?: Array<{ dataUrl: string }>;
	maxTokens?: number;
	signal?: AbortSignal;
};

export type StreamLlmParams = LlmCallParams & {
	onDelta: (delta: string) => void | Promise<void>;
};

function humanMessage(input: string, images: Array<{ dataUrl: string }> | undefined) {
	if (!images || images.length === 0) {
		return new HumanMessage(input);
	}

	return new HumanMessage({
		content: [
			{ type: "text" as const, text: input },
			...images.map((image) => ({
				type: "image_url" as const,
				image_url: { url: image.dataUrl },
			})),
		],
	});
}

function estimateTokens(text: string) {
	return Math.ceil(text.length / 4);
}

function createChatModel(env: LlmEnv, maxTokens: number, streaming: boolean) {
	if (streaming) {
		return new ChatOpenAI({
			model: env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
			apiKey: env.OPENROUTER_API_KEY,
			maxTokens,
			streaming: true,
			streamUsage: true,
			configuration: {
				baseURL: OPENROUTER_BASE_URL,
			},
		});
	}

	return new ChatOpenAI({
		model: env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
		apiKey: env.OPENROUTER_API_KEY,
		maxTokens,
		configuration: {
			baseURL: OPENROUTER_BASE_URL,
		},
	});
}

function extractText(content: HumanMessage["content"]) {
	if (typeof content === "string") {
		return content.trim();
	}

	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "string") {
				parts.push(block);
				continue;
			}
			if ("text" in block && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
		return parts.join("").trim();
	}

	return "";
}

function extractDelta(content: HumanMessage["content"]) {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "string") {
				parts.push(block);
				continue;
			}
			if ("text" in block && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
		return parts.join("");
	}

	return "";
}

function usageFromText(
	env: LlmEnv,
	params: { instructions: string; input: string; text: string },
	usage:
		| {
				input_tokens?: number;
				output_tokens?: number;
		  }
		| undefined,
) {
	const model = env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
	return {
		text: params.text,
		model,
		inputTokens:
			usage?.input_tokens ??
			estimateTokens(params.instructions + params.input),
		outputTokens: usage?.output_tokens ?? estimateTokens(params.text),
		cachedInputTokens: 0,
		reasoningTokens: 0,
	};
}

export async function callLlm(env: LlmEnv, params: LlmCallParams) {
	const maxTokens = params.maxTokens ?? 1024;
	const chat = createChatModel(env, maxTokens, false);
	const invokeOptions = params.signal ? { signal: params.signal } : undefined;

	const response = await chat.invoke(
		[new SystemMessage(params.instructions), humanMessage(params.input, params.images)],
		invokeOptions,
	);

	const text = extractText(response.content);
	if (!text) {
		throw new Error("No response from model");
	}

	return usageFromText(
		env,
		{ instructions: params.instructions, input: params.input, text },
		response.usage_metadata,
	);
}

export async function streamLlm(env: LlmEnv, params: StreamLlmParams) {
	const maxTokens = params.maxTokens ?? 1024;
	const chat = createChatModel(env, maxTokens, true);
	const streamOptions = params.signal ? { signal: params.signal } : undefined;

	const stream = await chat.stream(
		[new SystemMessage(params.instructions), humanMessage(params.input, params.images)],
		streamOptions,
	);

	let text = "";
	let usage: { input_tokens?: number; output_tokens?: number } | undefined;

	for await (const chunk of stream) {
		let delta = extractDelta(chunk.content);
		if (delta.length === 0 && typeof chunk.text === "string") {
			delta = chunk.text;
		}
		if (delta.length > 0) {
			text += delta;
			await params.onDelta(delta);
		}
		if (chunk.usage_metadata) {
			usage = chunk.usage_metadata;
		}
	}

	if (!text) {
		throw new Error("No response from model");
	}

	return usageFromText(
		env,
		{ instructions: params.instructions, input: params.input, text },
		usage,
	);
}
