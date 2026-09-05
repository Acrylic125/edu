import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamToolModel } from './llm';

afterEach(() => vi.unstubAllGlobals());
describe('native provider streaming contract', () => {
	it('assembles split tool arguments and retains provider usage', async () => {
		const chunk = (delta: object, finish_reason: string | null = null) => ({
			id: 'c1',
			model: 'test-model',
			object: 'chat.completion.chunk',
			created: 1,
			choices: [{ index: 0, delta, finish_reason, logprobs: null }],
		});
		const events = [
			chunk({
				role: 'assistant',
				content: null,
				tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'load_skill', arguments: '{"name":' } }],
			}),
			chunk({ tool_calls: [{ index: 0, function: { arguments: '"assess"}' } }] }),
			chunk({}, 'tool_calls'),
			{
				id: 'c1',
				model: 'test-model',
				object: 'chat.completion.chunk',
				created: 1,
				choices: [],
				usage: {
					prompt_tokens: 20,
					completion_tokens: 5,
					total_tokens: 25,
					cost: 0.0003,
					prompt_tokens_details: { cached_tokens: 10 },
					completion_tokens_details: { reasoning_tokens: 2 },
				},
			},
		];
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
					headers: { 'content-type': 'text/event-stream' },
				}),
			);
		vi.stubGlobal('fetch', fetchMock);
		const result = await streamToolModel(
			{ OPENROUTER_API_KEY: 'test' },
			{
				messages: [{ role: 'user', content: 'Check my answer' }],
				tools: [
					{ type: 'function', function: { name: 'load_skill', parameters: { type: 'object', properties: { name: { type: 'string' } } } } },
				],
				onDelta: vi.fn(),
			},
		);
		expect(result.response.tool_calls).toEqual([
			{ id: 'call_1', type: 'function', function: { name: 'load_skill', arguments: '{"name":"assess"}' } },
		]);
		expect(result).toMatchObject({ inputTokens: 20, outputTokens: 5, cachedInputTokens: 10, reasoningTokens: 2, costMicros: 300 });
	});
	it('does not contact the provider after cancellation', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(
			streamToolModel({ OPENROUTER_API_KEY: 'test' }, { messages: [], signal: AbortSignal.abort(), onDelta: vi.fn() }),
		).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
