import { describe, expect, it } from "vitest";
import { retrieveTrace } from "./langtrace.js";

describe("retrieveTrace", () => {
	it("resolves the project and finds an exact trace on a later page", async () => {
		const requests: Array<{ url: string; body?: string }> = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = input.toString();
			requests.push({ url, body: init?.body?.toString() });

			if (url.endsWith("/api/project")) {
				return Response.json({ project: { id: "project-1", name: "Edu" } });
			}

			const body = JSON.parse(init?.body?.toString() ?? "{}");
			if (body.page === 1) {
				return Response.json({
					traces: {
						result: [[{ trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "first" }]],
						metadata: { page: 1, page_size: 100, total_pages: 2 },
					},
				});
			}

			return Response.json({
				traces: {
					result: [[{ trace_id: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", name: "target" }]],
					metadata: { page: 2, page_size: 100, total_pages: 2 },
				},
			});
		};

		const trace = await retrieveTrace(
			{
				traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				apiKey: "test-key",
				apiHost: "https://app.langtrace.ai",
			},
			fetcher,
		);

		expect(trace).toEqual([
			{ trace_id: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", name: "target" },
		]);
		expect(requests).toHaveLength(3);
		expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
			page: 1,
			pageSize: 100,
			projectId: "project-1",
		});
	});

	it("returns null after searching all available pages", async () => {
		const fetcher: typeof fetch = async (input) => {
			if (input.toString().endsWith("/api/project")) {
				return Response.json({ project: { id: "project-1" } });
			}

			return Response.json({
				traces: {
					result: [],
					metadata: { page: 1, page_size: 100, total_pages: 1 },
				},
			});
		};

		const trace = await retrieveTrace(
			{
				traceId: "cccccccccccccccccccccccccccccccc",
				apiKey: "test-key",
				apiHost: "https://app.langtrace.ai",
			},
			fetcher,
		);

		expect(trace).toBeNull();
	});
});
