import { CHAT_COMMANDS } from '@edu/chat-contract';

export function parseExplicitCommand(message: string) {
	const match = message.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return null;
	const command = CHAT_COMMANDS.find((command) => command.name === match[1]);
	if (!command) return null;
	return { type: command.intent, message: (match[2] ?? '').trim() };
}
