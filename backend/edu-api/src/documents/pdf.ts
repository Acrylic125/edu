import { safetyLimits } from '../billing/plans';
import { getDocumentProxy } from 'unpdf';

import { createDb } from '../../db/client';
import { getOwnedAsset } from '../assets/repository';
import {
	failPdfIndex,
	getOwnedPdfDocument,
	markPdfIndexing,
	savePdfPage,
	updatePdfProgress,
} from './repository';

export const PDF_INDEX_BATCH_SIZE = 5;
export const MAX_PDF_PAGES = safetyLimits.pdfPagesPerFile;

export type PdfIndexJob = { assetId: string; userId: string; nextPage: number };

export async function indexPdfBatch(env: Env, job: PdfIndexJob) {
	const db = createDb(env.DB);
	const row = await getOwnedAsset(db, job.userId, job.assetId);
	if (!row || row.mimeType !== 'application/pdf') return;
	const existing = await getOwnedPdfDocument(db, job.userId, job.assetId);
	if (existing?.status === 'ready') return;
	const expectedLastPage = Math.min(existing?.pageCount ?? Number.MAX_SAFE_INTEGER, job.nextPage + PDF_INDEX_BATCH_SIZE - 1);
	if (existing && existing.pageCount && existing.indexedPages >= expectedLastPage) {
		await env.PDF_INDEX_QUEUE.send({ assetId: row.id, userId: job.userId, nextPage: existing.indexedPages + 1 });
		return;
	}

	try {
		const object = await env.ASSETS.get(row.storageKey);
		if (!object) throw new Error('PDF file is missing');
		const pdf = await getDocumentProxy(new Uint8Array(await object.arrayBuffer()));
		if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit`);
		await markPdfIndexing(db, row.id, pdf.numPages);

		const lastPage = Math.min(pdf.numPages, job.nextPage + PDF_INDEX_BATCH_SIZE - 1);
		for (let pageNumber = job.nextPage; pageNumber <= lastPage; pageNumber += 1) {
			const page = await pdf.getPage(pageNumber);
			const content = await page.getTextContent();
			const pieces: string[] = [];
			for (const item of content.items) {
				if ('str' in item && typeof item.str === 'string') pieces.push(item.str);
			}
			const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
			const storageKey = `${row.storageKey}/pages/${pageNumber}.txt`;
			await env.ASSETS.put(storageKey, text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
			await savePdfPage(db, { assetId: row.id, pageNumber, storageKey, text });
		}

		const ready = lastPage === pdf.numPages;
		await updatePdfProgress(db, row.id, lastPage, ready);
		if (!ready) {
			await env.PDF_INDEX_QUEUE.send({ assetId: row.id, userId: job.userId, nextPage: lastPage + 1 });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'PDF indexing failed';
		await failPdfIndex(db, job.assetId, message);
		throw error;
	}
}
