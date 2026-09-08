import { safetyLimits } from '../billing/plans';
import OpenAI from 'openai';
import { z } from 'zod';
import type {
	ChatCompletion,
	ChatCompletionCreateParams,
	ChatCompletionMessageParam,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
	ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';
import { context, SpanKind, SpanStatusCode, trace, type Context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createLangtraceExporter } from './langtrace-exporter';

export const DEFAULT_MODEL = 'openai/gpt-5.6-luna';
const DEFAULT_MAX_TOKENS = safetyLimits.outputTokensPerCall;
export type LlmEnv = {
	LANGTRACE_API_HOST?: string;
	LANGTRACE_API_KEY?: string;
	OPENROUTER_API_KEY: string;
	OPENROUTER_BASE_URL?: string;
	OPENROUTER_MODEL?: string;
};
export type LlmCallParams = {
	instructions: string;
	input: string;
	images?: Array<{ dataUrl: string }>;
	maxTokens?: number;
	signal?: AbortSignal;
	traceContext?: Context;
};
export type StreamLlmParams = LlmCallParams & { onDelta: (delta: string) => void | Promise<void> };
let langtraceInitialized = false;
let langtraceTracer = trace.getTracer('edu-api');
let langtraceProvider: BasicTracerProvider | null = null;
function initializeLangtrace(env: LlmEnv) {
	if (langtraceInitialized || (!env.LANGTRACE_API_KEY && !env.LANGTRACE_API_HOST)) return;
	const provider = new BasicTracerProvider({
		spanProcessors: [
			new SimpleSpanProcessor(
				createLangtraceExporter(env.LANGTRACE_API_KEY ?? '', env.LANGTRACE_API_HOST ?? 'https://app.langtrace.ai/api/trace'),
			),
		],
	});
	context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
	trace.setGlobalTracerProvider(provider);
	langtraceTracer = trace.getTracer('edu-api');
	langtraceProvider = provider;
	langtraceInitialized = true;
}

function traceJson(value: object) {
	return JSON.stringify(value).replace(/data:image\/[^;,\"]+;base64,[A-Za-z0-9+/=]+/g, '[image omitted]');
}

function promptEvent(messages: ChatCompletionMessageParam[]) {
	return traceJson(messages);
}

function completionEvent(completion: ChatCompletion) {
	return traceJson(completion.choices.map((choice) => choice.message));
}

async function flushLangtrace() {
	try {
		await langtraceProvider?.forceFlush();
	} catch (error) {
		console.error('Langtrace export failed', error);
	}
}

async function traceChatCompletion(
	env: LlmEnv,
	request: ChatCompletionCreateParams,
	call: () => Promise<ChatCompletion>,
	parentContext?: Context,
) {
	initializeLangtrace(env);
	if (!langtraceInitialized) return call();

	const activeContext = parentContext ?? context.active();
	const span = langtraceTracer.startSpan(
		'openai.chat.completions',
		{
			kind: SpanKind.CLIENT,
			attributes: {
				'langtrace.service.name': 'openai',
				'langtrace.service.type': 'llm',
				'gen_ai.operation.name': 'chat',
				'gen_ai.system': 'openrouter',
				'gen_ai.request.model': request.model,
				'gen_ai.request.stream': request.stream ?? false,
				...(request.max_tokens == null ? {} : { 'gen_ai.request.max_tokens': request.max_tokens }),
				...(request.tools ? { 'gen_ai.request.tools': JSON.stringify(request.tools) } : {}),
				'url.full': env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
				'url.path': '/chat/completions',
			},
		},
		activeContext,
	);
	span.addEvent('gen_ai.content.prompt', { 'gen_ai.prompt': promptEvent(request.messages) });

	return context.with(trace.setSpan(activeContext, span), async () => {
		try {
			const completion = await call();
			span.addEvent('gen_ai.content.completion', { 'gen_ai.completion': completionEvent(completion) });
			span.setAttributes({
				'gen_ai.response.model': completion.model,
				'gen_ai.usage.input_tokens': completion.usage?.prompt_tokens ?? 0,
				'gen_ai.usage.output_tokens': completion.usage?.completion_tokens ?? 0,
				'gen_ai.usage.total_tokens': completion.usage?.total_tokens ?? 0,
			});
			span.setStatus({ code: SpanStatusCode.OK });
			return completion;
		} catch (error) {
			span.recordException(error instanceof Error ? error : String(error));
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
		}
	});
}

export async function withLlmTrace<T>(
	env: LlmEnv,
	metadata: { runId: string; sessionId: string; userId: string; input: string },
	fn: (traceContext?: Context) => Promise<T>,
) {
	initializeLangtrace(env);
	if (!langtraceInitialized) {
		return fn();
	}

	const span = langtraceTracer.startSpan('chat.run', {
		attributes: {
			'langtrace.service.name': 'edu-api',
			'langtrace.service.type': 'agent',
			'edu.run.id': metadata.runId,
			'session.id': metadata.sessionId,
			user_id: metadata.userId,
		},
	});
	span.addEvent('gen_ai.content.prompt', {
		'gen_ai.prompt': JSON.stringify([{ role: 'user', content: metadata.input }]),
	});
	const runContext = trace.setSpan(context.active(), span);
	return context.with(runContext, async () => {
		try {
			const result = await fn(runContext);
			span.addEvent('gen_ai.content.completion', {
				'gen_ai.completion': JSON.stringify([{ role: 'assistant', content: JSON.stringify(result) }]),
			});
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (error) {
			span.recordException(error instanceof Error ? error : String(error));
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
			await flushLangtrace();
		}
	});
}

export function humanMessage(input: string, images?: Array<{ dataUrl: string }>) {
	const content: ChatCompletionUserMessageParam['content'] = [{ type: 'text', text: input }];
	for (const image of images ?? []) content.push({ type: 'image_url', image_url: { url: image.dataUrl } });
	return { role: 'user', content } satisfies ChatCompletionUserMessageParam;
}

function createClient(env: LlmEnv) {
	return new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1', timeout: 45000, maxRetries: 0 });
}

const ProviderCostSchema = z.object({ cost: z.number().finite().nonnegative() });

function modelUsage(env: LlmEnv, completion: ChatCompletion, input: string) {
	const text = completion.choices[0]?.message.content ?? '';
	const providerCost = ProviderCostSchema.safeParse(completion.usage);
	let costMicros: number | null = null;
	if (providerCost.success) costMicros = Math.round(providerCost.data.cost * 1_000_000);
	return {
		text,
		costMicros,
		model: completion.model || env.OPENROUTER_MODEL || DEFAULT_MODEL,
		inputTokens: completion.usage?.prompt_tokens ?? Math.ceil(input.length / 4),
		outputTokens: completion.usage?.completion_tokens ?? Math.ceil(text.length / 4),
		cachedInputTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
		reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
	};
}

export async function callLlm(env: LlmEnv, params: LlmCallParams) {
	params.signal?.throwIfAborted();
	const request = {
		model: env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
		max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
		messages: [{ role: 'system', content: params.instructions }, humanMessage(params.input, params.images)],
	} satisfies ChatCompletionCreateParams;
	const completion = await traceChatCompletion(
		env,
		request,
		() => createClient(env).chat.completions.create(request, { signal: params.signal }),
		params.traceContext,
	);
	const result = modelUsage(env, completion, params.instructions + params.input);
	if (!result.text) throw new Error('No response from model');
	return result;
}

export async function streamToolModel(
	env: LlmEnv,
	params: {
		messages: ChatCompletionMessageParam[];
		tools?: ChatCompletionTool[];
		toolChoice?: ChatCompletionToolChoiceOption;
		signal?: AbortSignal;
		maxTokens?: number;
		traceContext?: Context;
		onDelta: (text: string) => void | Promise<void>;
	},
) {
	params.signal?.throwIfAborted();
	const request = {
		model: env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
		max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
		messages: params.messages,
		tools: params.tools,
		tool_choice: params.toolChoice,
		...(params.tools ? { parallel_tool_calls: false } : {}),
		stream: true,
		stream_options: { include_usage: true },
	} satisfies ChatCompletionCreateParams;
	const completion = await traceChatCompletion(env, request, async () => {
		const stream = createClient(env).chat.completions.stream(request, { signal: params.signal });
		for await (const chunk of stream) {
			params.signal?.throwIfAborted();
			const text = chunk.choices[0]?.delta.content;
			if (text) await params.onDelta(text);
		}
		return stream.finalChatCompletion();
	}, params.traceContext);
	const response = completion.choices[0]?.message;
	if (!response) throw new Error('No response from model');
	return { ...modelUsage(env, completion, JSON.stringify(params.messages)), response };
}

export async function streamLlm(env: LlmEnv, params: StreamLlmParams) {
	const result = await streamToolModel(env, {
		messages: [{ role: 'system', content: params.instructions }, humanMessage(params.input, params.images)],
		maxTokens: params.maxTokens,
		signal: params.signal,
		onDelta: params.onDelta,
	});
	if (!result.text) throw new Error('No response from model');
	return result;
}
