import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import * as openai from "openai";
import {
	context,
	trace,
	SpanStatusCode,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
	chatCompletionCreate,
	embeddingsCreate,
	imageEdit,
	imagesGenerate,
} from "@langtrase/typescript-sdk/dist/instrumentation/openai/patch";
import { createLangtraceExporter } from "./langtrace-exporter";

export const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type LlmEnv = {
	LANGTRACE_API_HOST?: string;
	LANGTRACE_API_KEY?: string;
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

let langtraceInitialized = false;

let langtraceTracer = trace.getTracer("edu-api");

function initializeLangtrace(env: LlmEnv) {
	if (langtraceInitialized || (!env.LANGTRACE_API_KEY && !env.LANGTRACE_API_HOST)) {
		return;
	}

	const provider = new BasicTracerProvider();
	provider.addSpanProcessor(
		new SimpleSpanProcessor(
			createLangtraceExporter(
				env.LANGTRACE_API_KEY ?? "",
				env.LANGTRACE_API_HOST ?? "https://app.langtrace.ai/api/trace",
			),
		),
	);
	context.setGlobalContextManager(
		new AsyncLocalStorageContextManager().enable(),
	);
	trace.setGlobalTracerProvider(provider);

	const tracer = trace.getTracer("edu-api");
	langtraceTracer = tracer;
	const openAiVersion = "5.12.2";
	const langtraceVersion = "6.3.7";
	openai.OpenAI.Chat.Completions.prototype.create = chatCompletionCreate(
		openai.OpenAI.Chat.Completions.prototype.create,
		tracer,
		langtraceVersion,
		openAiVersion,
	) as typeof openai.OpenAI.Chat.Completions.prototype.create;
	openai.OpenAI.Images.prototype.generate = imagesGenerate(
		openai.OpenAI.Images.prototype.generate,
		tracer,
		langtraceVersion,
		openAiVersion,
	) as typeof openai.OpenAI.Images.prototype.generate;
	openai.OpenAI.Images.prototype.edit = imageEdit(
		openai.OpenAI.Images.prototype.edit,
		tracer,
		langtraceVersion,
		openAiVersion,
	) as typeof openai.OpenAI.Images.prototype.edit;
	openai.OpenAI.Embeddings.prototype.create = embeddingsCreate(
		openai.OpenAI.Embeddings.prototype.create,
		tracer,
		langtraceVersion,
		openAiVersion,
	) as typeof openai.OpenAI.Embeddings.prototype.create;
	langtraceInitialized = true;
}

export async function withLlmTrace<T>(env: LlmEnv, runId: string, fn: () => Promise<T>) {
	initializeLangtrace(env);
	if (!langtraceInitialized) {
		return fn();
	}

	const span = langtraceTracer.startSpan("chat.run", {
		attributes: {
			"langtrace.service.name": "edu-api",
			"langtrace.service.type": "agent",
			"edu.run.id": runId,
		},
	});
	return context.with(trace.setSpan(context.active(), span), async () => {
		try {
			const result = await fn();
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (error) {
			span.recordException(error instanceof Error ? error : String(error));
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
		}
	});
}

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
	initializeLangtrace(env);

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
