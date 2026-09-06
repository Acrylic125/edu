# Edu

Edu is deployed as two Cloudflare Workers:

- `edu-api` — API, Durable Objects, D1, and R2 access.
- `edu-web-production-ben` — the Next.js app built with OpenNext and served at `https://edu.benapps.dev`.

Production deployments run from [`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml) on pushes to `main` or through a manual workflow dispatch.

## GitHub Actions environment

Create a GitHub environment named `production` and add the following values.

### Variables

These are non-secret configuration values:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_DATABASE_ID
GOOGLE_CLIENT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_TENANT_ID
```

### Secrets

These values must be stored as GitHub environment secrets:

```text
CLOUDFLARE_DEPLOY_TOKEN
BETTER_AUTH_SECRET
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_SECRET
CLOUDFLARE_TOKEN
LANGTRACE_API_KEY
OPENROUTER_API_KEY
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`CLOUDFLARE_DEPLOY_TOKEN` is the CI/CD token used by Wrangler. The workflow maps it to Wrangler's required `CLOUDFLARE_API_TOKEN` environment variable.

`CLOUDFLARE_TOKEN` is separate: it is injected into the web Worker at runtime and is used by the server-side D1 HTTP client. Keep it separate from the deployment token and scope it only to the D1 resources the app needs.

The runtime token needs `D1: Write` access because Better Auth performs reads and writes through the D1 HTTP API. It does not need Workers, Routes, R2, DNS, or account-management permissions.

## Deployment token scopes

Create a custom Cloudflare API token for `CLOUDFLARE_DEPLOY_TOKEN` with the following least-privilege permissions:

Account permissions:

- `Account Settings: Read`
- `Workers Scripts: Edit`
- `D1: Write`
- `Workers R2 Storage: Edit`

Zone permissions:

- `Workers Routes: Edit`, scoped to the `benapps.dev` zone.

The token is used to deploy both Workers, apply remote D1 migrations, update the R2-backed Worker configuration, create the `edu.benapps.dev` route, and update Worker secrets. It does not need Pages, KV, DNS, Images, or administrator access.

Cloudflare references:

- [GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
