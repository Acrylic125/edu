import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getOwnedPdfDocument: vi.fn(),
	listPdfPageIndex: vi.fn(),
	listPdfPages: vi.fn(),
}));

vi.mock('./repository', () => mocks);

import { readPdfIndex, readPdfPages } from './read';

describe('PDF retrieval', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOwnedPdfDocument.mockResolvedValue({
			assetId: 'ast_pdf',
			filename: 'course.pdf',
			status: 'ready',
			pageCount: 40,
			indexedPages: 40,
			error: null,
		});
	});

	it('returns only matching page previews from the index', async () => {
		mocks.listPdfPageIndex.mockResolvedValue([
			{ pageNumber: 1, preview: 'Introduction', searchText: 'introduction', charCount: 12 },
			{ pageNumber: 7, preview: 'Cache coherence protocols', searchText: 'cache coherence protocols', charCount: 25 },
			{ pageNumber: 8, preview: 'Directory based cache coherence', searchText: 'directory based cache coherence', charCount: 31 },
		]);

		const result = await readPdfIndex({} as never, 'user_1', { assetId: 'ast_pdf', query: 'cache coherence' });

		expect(result.pages.map((page) => page.pageNumber)).toEqual([7, 8]);
		expect(result.coverage).toBe('40/40');
	});

	it('reads only requested indexed pages and reports unavailable pages', async () => {
		mocks.listPdfPages.mockResolvedValue([
			{ pageNumber: 7, storageKey: 'page-7', charCount: 11 },
		]);
		const get = vi.fn().mockResolvedValue({ text: () => Promise.resolve('page seven') });

		const result = await readPdfPages(
			{} as never,
			{ ASSETS: { get } } as never,
			'user_1',
			'ast_pdf',
			[7, 19],
		);

		expect(get).toHaveBeenCalledOnce();
		expect(result.pages).toEqual([{ pageNumber: 7, text: 'page seven', truncated: false, hasExtractableText: true }]);
		expect(result.unavailablePages).toEqual([19]);
	});

	it('does not reveal whether another user owns a document', async () => {
		mocks.getOwnedPdfDocument.mockResolvedValue(null);
		await expect(readPdfIndex({} as never, 'user_2', { assetId: 'ast_pdf' })).rejects.toThrow('PDF not found');
	});
});
