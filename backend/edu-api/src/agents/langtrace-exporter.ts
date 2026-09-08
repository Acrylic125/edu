import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

export function createLangtraceExporter(apiKey: string, apiHost: string): SpanExporter {
	return {
		export(spans, resultCallback) {
			const payload = spans.map((span) => ({
				traceId: span.spanContext().traceId,
				spanId: span.spanContext().spanId,
				traceState: span.spanContext().traceState?.serialize(),
				name: span.name,
				startTime: span.startTime,
				endTime: span.endTime,
				attributes: span.attributes,
				kind: span.kind,
				status: span.status,
				events: span.events,
				resource: span.resource,
				links: span.links,
				parentSpanId: span.parentSpanContext?.spanId,
				instrumentationLibrary: span.instrumentationScope,
				duration: span.duration,
				droppedEventsCount: span.droppedEventsCount,
				droppedAttributesCount: span.droppedAttributesCount,
				droppedLinksCount: span.droppedLinksCount,
				ended: span.ended,
			}));

			void fetch(apiHost, {
				method: 'POST',
				signal: AbortSignal.timeout(5000),
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'LangTraceExporter',
					...(apiKey ? { 'x-api-key': apiKey } : {}),
				},
				body: JSON.stringify(payload),
			})
				.then(async (response) => {
					if (response.ok) {
						resultCallback({ code: 0 });
						return;
					}

					const details = await response.text();
					console.error(`Failed to export ${spans.length} spans to Langtrace: ${response.status} ${details}`);
					resultCallback({
						code: 1,
						error: new Error(`Failed to export ${spans.length} spans to ${apiHost}: ${response.status} ${details}`),
					});
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`Failed to export ${spans.length} spans to Langtrace: ${message}`);
					resultCallback({
						code: 1,
						error: new Error(`Failed to export ${spans.length} spans to ${apiHost}: ${message}`),
					});
				});
		},
		shutdown() {
			return Promise.resolve();
		},
	};
}
