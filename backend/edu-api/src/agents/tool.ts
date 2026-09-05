import type {
	ChatCompletionTool,
	ChatCompletionMessageFunctionToolCall,
	ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// One validated boundary for model arguments and provider-native tool definitions.
export function tool<Shape extends z.ZodRawShape>(
	execute: (input: z.output<z.ZodObject<Shape>>) => string | ChatCompletionContentPart[] | Promise<string | ChatCompletionContentPart[]>,
	fields: { name: string; description: string; schema: z.ZodObject<Shape> },
) {
	const definition: ChatCompletionTool = {
		type: 'function',
		function: { name: fields.name, description: fields.description, parameters: zodToJsonSchema(fields.schema) },
	};
	return {
		name: fields.name,
		definition,
		async invoke(call: ChatCompletionMessageFunctionToolCall) {
			if (!call.id) throw new Error('Missing tool call ID');
			try {
				const input = fields.schema.strict().safeParse(JSON.parse(call.function.arguments));
				if (!input.success) return 'Invalid tool arguments. Check the schema and try again.';
				return await execute(input.data);
			} catch (error) {
				if (error instanceof SyntaxError) return 'Invalid JSON arguments. Try again.';
				throw error;
			}
		},
	};
}
