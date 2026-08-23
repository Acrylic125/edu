import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

export const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type LlmEnv = {
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
};

export type LlmResult = {
	text: string;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningTokens: number;
	model: string;
};

function estimateTokens(text: string) {
	return Math.ceil(text.length / 4);
}

function createChatModel(env: LlmEnv, maxTokens: number) {
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

export async function callLlm(
	env: LlmEnv,
	params: {
		instructions: string;
		input: string;
		maxTokens?: number;
	},
) {
	const model = env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
	const maxTokens = params.maxTokens ?? 1024;
	const chat = createChatModel(env, maxTokens);

	const response = await chat.invoke([
		new SystemMessage(params.instructions),
		new HumanMessage(params.input),
	]);

	const text = extractText(response.content);
	if (!text) {
		throw new Error("No response from model");
	}

	const usage = response.usage_metadata;

	return {
		text,
		model,
		inputTokens:
			usage?.input_tokens ??
			estimateTokens(params.instructions + params.input),
		outputTokens: usage?.output_tokens ?? estimateTokens(text),
		cachedInputTokens: 0,
		reasoningTokens: 0,
	};
}
