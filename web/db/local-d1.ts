import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { drizzle } from "drizzle-orm/node-sqlite"

import * as schema from "./schema"
import { env } from "@/env"

function eduApiStateDir() {
	if (env.AUTH_D1_STATE_DIR) {
		return path.resolve(env.AUTH_D1_STATE_DIR)
	}
	return path.resolve(
		process.cwd(),
		"../backend/edu-api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
	)
}

function resolveLocalD1Path() {
	const dir = eduApiStateDir()
	if (!fs.existsSync(dir)) {
		throw new Error(
			`Local D1 not found at ${dir}. From backend/edu-api run: pnpm run db:migrate:local && pnpm wrangler dev`,
		)
	}

	const files: string[] = []
	function collect(current: string) {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const entryPath = path.join(current, entry.name)
			if (entry.isDirectory()) {
				collect(entryPath)
				continue
			}
			if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") files.push(entryPath)
		}
	}
	collect(dir)

	for (const name of files) {
		const probe = new DatabaseSync(name, { readOnly: true })
		try {
			const row = probe
				.prepare(
					"SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'session' LIMIT 1",
				)
				.get()
			if (row) {
				return name
			}
		} finally {
			probe.close()
		}
	}

	throw new Error(
		`No local D1 with a session table under ${dir}. From backend/edu-api run: pnpm run db:migrate:local`,
	)
}

export function createLocalDb() {
	const filePath = resolveLocalD1Path()
	const client = new DatabaseSync(filePath)
	client.exec("PRAGMA busy_timeout = 5000;")
	return drizzle({ client, schema })
}
