import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getDocumentProxy: vi.fn(),
	getOwnedAsset: vi.fn(),
	getOwnedPdfDocument: vi.fn(),
	markPdfIndexing: vi.fn(),
	savePdfPage: vi.fn(),
	updatePdfProgress: vi.fn(),
	failPdfIndex: vi.fn(),
}));

vi.mock('unpdf', () => ({ getDocumentProxy: mocks.getDocumentProxy }));
vi.mock('../../db/client', () => ({ createDb: () => ({}) }));
vi.mock('../assets/repository', () => ({ getOwnedAsset: mocks.getOwnedAsset }));
vi.mock('./repository', () => ({
	getOwnedPdfDocument: mocks.getOwnedPdfDocument,
	markPdfIndexing: mocks.markPdfIndexing,
	savePdfPage: mocks.savePdfPage,
	updatePdfProgress: mocks.updatePdfProgress,
	failPdfIndex: mocks.failPdfIndex,
}));

import { indexPdfBatch, PDF_INDEX_BATCH_SIZE } from './pdf';

describe('PDF indexing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOwnedAsset.mockResolvedValue({ id: 'ast_pdf', mimeType: 'application/pdf', storageKey: 'user/ast_pdf' });
		mocks.getOwnedPdfDocument.mockResolvedValue({ status: 'queued', pageCount: null, indexedPages: 0 });
	});

	it('extracts one bounded page batch and queues the next batch', async () => {
		const getPage = vi.fn(async (pageNumber: number) => ({
			getTextContent: async () => ({ items: [{ str: `Page ${pageNumber}` }] }),
		}));
		mocks.getDocumentProxy.mockResolvedValue({ numPages: 12, getPage });
		const send = vi.fn();
		const put = vi.fn();
		const env = {
			DB: {},
			ASSETS: {
				get: vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
				put,
			},
			PDF_INDEX_QUEUE: { send },
		} as never;

		await indexPdfBatch(env, { assetId: 'ast_pdf', userId: 'user_1', nextPage: 1 });

		expect(getPage).toHaveBeenCalledTimes(PDF_INDEX_BATCH_SIZE);
		expect(getPage).toHaveBeenLastCalledWith(5);
		expect(put).toHaveBeenCalledTimes(PDF_INDEX_BATCH_SIZE);
		expect(mocks.updatePdfProgress).toHaveBeenCalledWith(expect.anything(), 'ast_pdf', 5, false);
		expect(send).toHaveBeenCalledWith({ assetId: 'ast_pdf', userId: 'user_1', nextPage: 6 });
	});
});
