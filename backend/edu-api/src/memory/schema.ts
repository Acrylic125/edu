import { z } from "zod";

export const MemorySummarySchema = z.object({
	summary: z.string().min(1),
	keywords: z.array(z.string().min(1)).max(12).default([]),
});

export const MemoryKeywordsSchema = z.array(z.string());

export const MemoryImageAssetIdsSchema = z.array(z.string());

export const MemoryExpansionSchema = z.object({
	memoryIds: z.array(z.string()).max(2).default([]),
});

export type RetrievedMemory = {
	id: string;
	topicId: string | null;
	intent: string | null;
	summary: string;
	keywords: string[];
	createdAt: Date;
	hasImages: boolean;
};

export type RetrievedExchange = {
	memoryId: string;
	request: string;
	response: string;
	images: Array<{
		id: string;
		filename: string | null;
		mimeType: string;
	}>;
};
