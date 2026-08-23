import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";

import { createDb } from "../db/client";
import * as schema from "../db/schema";

export function createAuth(env: Env) {
	if (!env.DB) {
		throw new Error("DB is not configured");
	}
	if (!env.BETTER_AUTH_SECRET) {
		throw new Error("BETTER_AUTH_SECRET is not configured");
	}

	const db = createDb(env.DB);

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.WEB_ORIGIN,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		plugins: [bearer()],
	});
}
