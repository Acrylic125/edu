import { z } from "zod";

const projectResponseSchema = z.object({
	project: z.object({
		id: z.string().min(1),
	}),
});

const spanSchema = z
	.object({
		trace_id: z.string(),
	})
	.loose();

const tracesResponseSchema = z.object({
	traces: z.object({
		result: z.array(z.array(spanSchema)),
		metadata: z.object({
			page: z.number(),
			page_size: z.number(),
			total_pages: z.number(),
		}),
	}),
});

const retrieveTraceOptionsSchema = z.object({
	traceId: z.string().regex(/^(?:0x)?[a-fA-F0-9]{32}$/, "must be a 32-character hexadecimal trace ID"),
	apiKey: z.string().min(1, "LANGTRACE_API_KEY is required"),
	apiHost: z.url(),
});

function normalizeTraceId(traceId: string) {
	return traceId.toLowerCase().replace(/^0x/, "");
}

async function assertSuccessful(response: Response) {
	if (response.ok) {
		return;
	}

	const details = await response.text();
	throw new Error(`Langtrace request failed (${response.status}): ${details || response.statusText}`);
}

export async function retrieveTrace(
	options: z.input<typeof retrieveTraceOptionsSchema>,
	fetcher: typeof fetch = fetch,
) {
	const { traceId, apiKey, apiHost } = retrieveTraceOptionsSchema.parse(options);
	const headers = {
		"Content-Type": "application/json",
		"x-api-key": apiKey,
	};

	const projectResponse = await fetcher(new URL("/api/project", apiHost), { headers });
	await assertSuccessful(projectResponse);
	const { project } = projectResponseSchema.parse(await projectResponse.json());

	const requestedTraceId = normalizeTraceId(traceId);
	let page = 1;
	let totalPages = 1;

	do {
		const tracesResponse = await fetcher(new URL("/api/traces", apiHost), {
			method: "POST",
			headers,
			body: JSON.stringify({
				page,
				pageSize: 100,
				projectId: project.id,
			}),
		});
		await assertSuccessful(tracesResponse);

		const { traces } = tracesResponseSchema.parse(await tracesResponse.json());
		const trace = traces.result.find((spans) =>
			spans.some((span) => normalizeTraceId(span.trace_id) === requestedTraceId),
		);

		if (trace) {
			return trace;
		}

		totalPages = traces.metadata.total_pages;
		page += 1;
	} while (page <= totalPages);

	return null;
}
