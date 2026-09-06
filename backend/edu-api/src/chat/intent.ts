import { CHAT_COMMANDS } from '@edu/chat-contract';

export function parseExplicitCommand(message: string) {
	const match = message.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return null;
	const command = CHAT_COMMANDS.find((command) => command.name === match[1]);
	if (!command) return null;
	return { type: command.intent, message: (match[2] ?? '').trim() };
}

const ADVANCE_REQUESTS = new Set([
	'continue to next topic',
	'continue to the next topic',
	'move to next topic',
	'move to the next topic',
	'move on to next topic',
	'move on to the next topic',
	'next topic',
]);

export function isExplicitAdvanceRequest(message: string) {
	let normalized = message.trim().toLowerCase();
	while (normalized.endsWith('.') || normalized.endsWith('!')) normalized = normalized.slice(0, -1).trimEnd();
	return ADVANCE_REQUESTS.has(normalized);
}
