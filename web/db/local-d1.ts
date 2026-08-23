import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { drizzle } from "drizzle-orm/node-sqlite"

import * as schema from "./schema"

function eduApiStateDir() {
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

	const files = fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")

	for (const name of files) {
		const filePath = path.join(dir, name)
		const probe = new DatabaseSync(filePath, { readOnly: true })
		try {
			const row = probe
				.prepare(
					"SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'session' LIMIT 1",
				)
				.get()
			if (row) {
				return filePath
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
