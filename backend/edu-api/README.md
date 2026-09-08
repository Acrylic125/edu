# edu-api

## Local Dev

Auth sessions must live in the **same local D1** as `wrangler dev`.

Install dependencies with `pnpm install --frozen-lockfile` in each of
`packages/chat-contract`, `backend/edu-api`, and `web`. Both applications link
the shared contract package directly.

1. Apply local migrations: `pnpm run db:migrate:local`
2. Start the worker: `pnpm wrangler dev`
3. Start the web app (`pnpm dev` in `web/`). In development it opens the local D1 sqlite under `.wrangler/state` (not the remote Cloudflare DB).
4. Sign out and sign in again so the session is written locally.

PDF attachments are indexed in five-page queue jobs. Create the queues once before the first deployment:

```sh
pnpx wrangler queues create edu-pdf-index
pnpx wrangler queues create edu-pdf-index-production-ben
```

The original PDF and extracted page text live in the `ASSETS` R2 bucket. D1 stores indexing status and bounded page previews used by the tutor's PDF search tool.

`.dev.vars` `BETTER_AUTH_SECRET` must match web `BETTER_AUTH_SECRET`.

Set `LANGTRACE_API_KEY` in `.dev.vars` to export Tutor run traces. Model calls
use the OpenAI SDK through OpenRouter. For a self-hosted Langtrace instance, set
`LANGTRACE_API_HOST` to its `/api/trace` endpoint.

Force remote auth DB from Next while developing: `AUTH_D1_LOCAL=0`.

See [Tutor architecture](docs/agent/decision-tree.md) and the
[September 2026 audit](docs/agent/audit-2026-09-05.md) for the breaking contract,
migration, verification, and remaining limitations.

## Production (`env.production-ben`)

Put secrets remotely (one prompt each):

```sh
pnpx wrangler secret put BETTER_AUTH_SECRET --env production-ben
pnpx wrangler secret put LANGTRACE_API_KEY --env production-ben
pnpx wrangler secret put OPENROUTER_API_KEY --env production-ben
pnpx wrangler secret put R2_ACCESS_KEY_ID --env production-ben
pnpx wrangler secret put R2_SECRET_ACCESS_KEY --env production-ben
pnpx wrangler secret put OPENROUTER_MODEL --env production-ben   # optional
```

Deploy:

```sh
pnpx wrangler deploy --env production-ben
# or: pnpm run deploy:production-ben
```

D1 migrations:

```sh
pnpx wrangler d1 migrations apply edu-api --remote --env production-ben
# or: pnpm run db:migrate:remote:production-ben
```

R2 CORS for shared bucket `edu-assets` (local + production web origins):

```sh
pnpx wrangler r2 bucket cors set edu-assets --file /dev/stdin <<'EOF'
{
  "rules": [
    {
      "allowed": {
        "origins": ["http://localhost:3000", "https://edu.benapps.dev"],
        "methods": ["GET", "PUT", "HEAD"],
        "headers": ["Content-Type"]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
EOF
```

## Free and Pro plans

Plan configuration, allowance definitions, manual assignment, and the Stripe integration boundary are documented in [src/billing/README.md](src/billing/README.md).
