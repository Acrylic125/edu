export const WORDS_PER_FLUSH = 8;

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

export function takeWordChunk(pending: string) {
	let words = 0;
	let cut = -1;
	let inWord = false;

	for (let i = 0; i < pending.length; i += 1) {
		const char = pending[i];
		if (char === undefined) {
			break;
		}
		if (!WHITESPACE.has(char)) {
			inWord = true;
			continue;
		}
		if (!inWord) {
			continue;
		}
		inWord = false;
		words += 1;
		if (words === WORDS_PER_FLUSH) {
			cut = i + 1;
			while (cut < pending.length) {
				const next = pending[cut];
				if (next === undefined) {
					break;
				}
				if (!WHITESPACE.has(next)) {
					break;
				}
				cut += 1;
			}
			break;
		}
	}

	if (cut === -1) {
		return { chunk: '', rest: pending };
	}
	return { chunk: pending.slice(0, cut), rest: pending.slice(cut) };
}

export async function drainWordChunks(pending: string, incoming: string, onChunk: (chunk: string) => void) {
	let rest = pending + incoming;
	while (true) {
		const taken = takeWordChunk(rest);
		if (taken.chunk === '') {
			return rest;
		}
		rest = taken.rest;
		onChunk(taken.chunk);
	}
}

export function pushWords(pending: string, incoming: string) {
	let rest = pending + incoming;
	let flushed = '';
	while (true) {
		const taken = takeWordChunk(rest);
		if (taken.chunk === '') {
			break;
		}
		flushed += taken.chunk;
		rest = taken.rest;
	}
	return { pending: rest, flush: flushed };
}

export function flushWords(pending: string) {
	return { pending: '', flush: pending };
}
