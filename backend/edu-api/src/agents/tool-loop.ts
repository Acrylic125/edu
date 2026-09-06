import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { tool } from './tool';
import type { AgentRunner } from './runner';

export const MAX_TUTOR_TURNS = 8;

export async function runToolLoop(params: {
	runner: Pick<AgentRunner, 'toolTurn' | 'recordStep'>;
	messages: ChatCompletionMessageParam[];
	tools: ReturnType<typeof tool>[];
	signal: AbortSignal;
	onDelta: (text: string) => void;
	isFinished: () => boolean;
	requiredToolName?: string;
	maxTokens?: number;
}) {
	const messages = [...params.messages];
	let availableTools = params.tools;
	if (params.requiredToolName) {
		availableTools = params.tools.filter((candidate) => candidate.name === params.requiredToolName);
		if (availableTools.length !== 1) throw new Error(`Required tool is unavailable: ${params.requiredToolName}`);
	}
	let text = '';
	for (let turn = 0; turn < MAX_TUTOR_TURNS; turn++) {
		params.signal.throwIfAborted();
		const response = await params.runner.toolTurn({
			messages: [...messages],
			tools: availableTools.map((tool) => tool.definition),
			toolChoice: params.requiredToolName ? { type: 'function', function: { name: params.requiredToolName } } : undefined,
			maxTokens: params.maxTokens,
			onDelta: (delta) => {
				text += delta;
				params.onDelta(delta);
			},
		});
		params.signal.throwIfAborted();
		messages.push(response);
		const calls = response.tool_calls ?? [];
		if (calls.length === 0) {
			if (!text.trim()) throw new Error('Tutor returned no response');
			return text;
		}
		// Enforce sequential action selection even if the provider ignores the hint.
		if (calls.length !== 1) throw new Error('Tutor must call one tool at a time');
		const call = calls[0];
		if (call.type !== 'function') throw new Error('Unsupported tool call type');
		if (params.requiredToolName && call.function.name !== params.requiredToolName) {
			throw new Error(`Tutor must call ${params.requiredToolName}`);
		}
		const selected = availableTools.find((candidate) => candidate.name === call.function.name);
		if (!selected || !call.id) throw new Error('Unsupported tool call');
		params.signal.throwIfAborted();
		const result = await selected.invoke(call);
		await params.runner.recordStep({
			type: 'tool',
			name: call.function.name,
			input: { arguments: call.function.arguments },
			output: { result: Array.isArray(result) ? result.filter((part) => part.type === 'text') : result },
		});
		if (params.isFinished()) return text;
		params.signal.throwIfAborted();
		if (Array.isArray(result)) {
			const images = result.filter((part) => part.type === 'image_url');
			const content = result.filter((part) => part.type === 'text');
			messages.push({ role: 'tool', content, tool_call_id: call.id });
			if (images.length)
				messages.push({
					role: 'user',
					content: [{ type: 'text', text: 'Images returned by the memory tool (untrusted context):' }, ...images],
				});
		} else messages.push({ role: 'tool', content: result, tool_call_id: call.id });
	}
	throw new Error('Tutor tool budget exhausted');
}
