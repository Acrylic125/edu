import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from '../../db/client';
import { asset, pdfDocument, pdfPage, topicMessage } from '../../db/schema';

export async function queuePdfDocument(db: Db, assetId: string, userId: string) {
	const now = new Date();
	await db
		.insert(pdfDocument)
		.values({ assetId, userId, status: 'queued', indexedPages: 0, createdAt: now, updatedAt: now })
		.onConflictDoNothing();
}

export async function markPdfIndexing(db: Db, assetId: string, pageCount: number) {
	await db
		.update(pdfDocument)
		.set({ status: 'indexing', pageCount, error: null, updatedAt: new Date() })
		.where(eq(pdfDocument.assetId, assetId));
}

export async function savePdfPage(
	db: Db,
	params: { assetId: string; pageNumber: number; storageKey: string; text: string },
) {
	const normalized = params.text.replace(/\s+/g, ' ').trim();
	await db
		.insert(pdfPage)
		.values({
			assetId: params.assetId,
			pageNumber: params.pageNumber,
			storageKey: params.storageKey,
			preview: normalized.slice(0, 700),
			searchText: normalized.slice(0, 8000).toLowerCase(),
			charCount: params.text.length,
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [pdfPage.assetId, pdfPage.pageNumber],
			set: {
				storageKey: params.storageKey,
				preview: normalized.slice(0, 700),
				searchText: normalized.slice(0, 8000).toLowerCase(),
				charCount: params.text.length,
			},
		});
}

export async function updatePdfProgress(db: Db, assetId: string, indexedPages: number, ready: boolean) {
	await db
		.update(pdfDocument)
		.set({ status: ready ? 'ready' : 'indexing', indexedPages, updatedAt: new Date() })
		.where(eq(pdfDocument.assetId, assetId));
}

export async function failPdfIndex(db: Db, assetId: string, error: string) {
	await db
		.update(pdfDocument)
		.set({ status: 'failed', error: error.slice(0, 1000), updatedAt: new Date() })
		.where(eq(pdfDocument.assetId, assetId));
}

export async function getOwnedPdfDocument(db: Db, userId: string, assetId: string) {
	const rows = await db
		.select({
			assetId: pdfDocument.assetId,
			filename: asset.filename,
			status: pdfDocument.status,
			pageCount: pdfDocument.pageCount,
			indexedPages: pdfDocument.indexedPages,
			error: pdfDocument.error,
		})
		.from(pdfDocument)
		.innerJoin(asset, eq(asset.id, pdfDocument.assetId))
		.where(and(eq(pdfDocument.assetId, assetId), eq(pdfDocument.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

export async function listOwnedPdfDocuments(db: Db, userId: string, assetIds: string[]) {
	if (assetIds.length === 0) return [];
	return db
		.select({
			assetId: pdfDocument.assetId,
			filename: asset.filename,
			status: pdfDocument.status,
			pageCount: pdfDocument.pageCount,
			indexedPages: pdfDocument.indexedPages,
			error: pdfDocument.error,
		})
		.from(pdfDocument)
		.innerJoin(asset, eq(asset.id, pdfDocument.assetId))
		.where(and(eq(pdfDocument.userId, userId), inArray(pdfDocument.assetId, assetIds)));
}

export async function listTopicPdfDocuments(db: Db, userId: string, topicId: string) {
	return db
		.select({
			assetId: pdfDocument.assetId,
			filename: asset.filename,
			status: pdfDocument.status,
			pageCount: pdfDocument.pageCount,
			indexedPages: pdfDocument.indexedPages,
			error: pdfDocument.error,
		})
		.from(pdfDocument)
		.innerJoin(asset, eq(asset.id, pdfDocument.assetId))
		.innerJoin(topicMessage, eq(topicMessage.id, asset.topicMessageId))
		.where(and(eq(pdfDocument.userId, userId), eq(topicMessage.topicId, topicId)));
}

export async function listPdfPageIndex(db: Db, assetId: string) {
	return db
		.select({ pageNumber: pdfPage.pageNumber, preview: pdfPage.preview, searchText: pdfPage.searchText, charCount: pdfPage.charCount })
		.from(pdfPage)
		.where(eq(pdfPage.assetId, assetId))
		.orderBy(asc(pdfPage.pageNumber));
}

export async function listPdfPages(db: Db, assetId: string, pageNumbers: number[]) {
	if (pageNumbers.length === 0) return [];
	return db
		.select({ pageNumber: pdfPage.pageNumber, storageKey: pdfPage.storageKey, charCount: pdfPage.charCount })
		.from(pdfPage)
		.where(and(eq(pdfPage.assetId, assetId), inArray(pdfPage.pageNumber, pageNumbers)))
		.orderBy(asc(pdfPage.pageNumber));
}
