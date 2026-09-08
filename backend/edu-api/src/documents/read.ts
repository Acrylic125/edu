import type { Db } from '../../db/client';
import { getOwnedPdfDocument, listPdfPageIndex, listPdfPages } from './repository';

const INDEX_PAGE_SIZE = 20;
const MAX_PAGE_TEXT_CHARS = 12_000;
const MAX_TOTAL_TEXT_CHARS = 30_000;

export async function readPdfIndex(
	db: Db,
	userId: string,
	params: { assetId: string; query?: string; cursor?: number },
) {
	const document = await getOwnedPdfDocument(db, userId, params.assetId);
	if (!document) throw new Error('PDF not found');
	const pages = await listPdfPageIndex(db, params.assetId);
	let selected = pages;
	if (params.query) {
		const terms = params.query.toLowerCase().split(/\W+/).filter((term) => term.length > 1);
		selected = [...pages]
			.map((page) => ({ page, score: terms.reduce((score, term) => score + (page.searchText.includes(term) ? 1 : 0), 0) }))
			.filter((candidate) => candidate.score > 0)
			.sort((left, right) => right.score - left.score || left.page.pageNumber - right.page.pageNumber)
			.map((candidate) => candidate.page);
	}
	const cursor = params.cursor ?? 0;
	const pageSlice = selected.slice(cursor, cursor + INDEX_PAGE_SIZE).map((page) => ({
		pageNumber: page.pageNumber,
		preview: page.preview,
		charCount: page.charCount,
	}));
	return {
		document,
		coverage: `${document.indexedPages}/${document.pageCount ?? '?'}`,
		pages: pageSlice,
		nextCursor: cursor + pageSlice.length < selected.length ? cursor + pageSlice.length : null,
	};
}

export async function readPdfPages(db: Db, env: Env, userId: string, assetId: string, pageNumbers: number[]) {
	const document = await getOwnedPdfDocument(db, userId, assetId);
	if (!document) throw new Error('PDF not found');
	const uniquePages = [...new Set(pageNumbers)];
	const rows = await listPdfPages(db, assetId, uniquePages);
	let remaining = MAX_TOTAL_TEXT_CHARS;
	const pages = [];
	for (const row of rows) {
		const object = await env.ASSETS.get(row.storageKey);
		if (!object) continue;
		const fullText = await object.text();
		const text = fullText.slice(0, Math.min(MAX_PAGE_TEXT_CHARS, remaining));
		remaining -= text.length;
		pages.push({
			pageNumber: row.pageNumber,
			text,
			truncated: text.length < fullText.length,
			hasExtractableText: fullText.trim().length > 0,
		});
		if (remaining === 0) break;
	}
	return {
		document,
		pages,
		unavailablePages: uniquePages.filter((pageNumber) => !rows.some((row) => row.pageNumber === pageNumber)),
	};
}
