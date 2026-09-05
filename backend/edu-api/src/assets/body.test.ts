import { describe, expect, it } from 'vitest';
import { readLimitedBody } from './body';

describe('bounded uploads', () => {
	it('rejects excessive declared lengths before consuming the body', async () => {
		const request = new Request('https://example.test', { method: 'POST', body: 'small', headers: { 'content-length': '10000' } });
		await expect(readLimitedBody(request, 10)).rejects.toThrow('Body too large');
		expect(request.bodyUsed).toBe(false);
	});
	it('bounds actual streamed bytes even when the declared length is false', async () => {
		const request = new Request('https://example.test', { method: 'POST', body: 'a'.repeat(11), headers: { 'content-length': '1' } });
		await expect(readLimitedBody(request, 10)).rejects.toThrow('Body too large');
	});
	it('preserves a body at the limit', async () => {
		const bytes = await readLimitedBody(new Request('https://example.test', { method: 'POST', body: 'hello' }), 5);
		expect(new TextDecoder().decode(bytes)).toBe('hello');
	});
});
