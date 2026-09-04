#!/usr/bin/env node

import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { z } from "zod";
import { retrieveTrace } from "./langtrace.js";

try {
	loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch (error) {
	if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
		throw error;
	}
}

const envSchema = z.object({
	LANGTRACE_API_KEY: z.string().min(1),
	LANGTRACE_API_HOST: z.url().default("https://app.langtrace.ai"),
});

const [traceId, ...extraArguments] = process.argv.slice(2);

if (traceId === "--help" || traceId === "-h") {
	console.log("Usage: pnpm langtrace <trace-id>");
	process.exit(0);
}

if (!traceId || extraArguments.length > 0) {
	console.error("Usage: pnpm langtrace <trace-id>");
	process.exit(1);
}

try {
	const env = envSchema.parse(process.env);
	const trace = await retrieveTrace({
		traceId,
		apiKey: env.LANGTRACE_API_KEY,
		apiHost: env.LANGTRACE_API_HOST,
	});

	if (!trace) {
		console.error(`Trace not found: ${traceId}`);
		process.exitCode = 1;
	} else {
		console.log(JSON.stringify(trace, null, 2));
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Unable to retrieve trace: ${message}`);
	process.exitCode = 1;
}
