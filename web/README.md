This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Production deployment

The production deployment has two Cloudflare Workers: `edu-api` serves the
API and `edu-web-production-ben` serves the Next.js app. Deploy the API first
so the web app can reach `https://edu-api.benapps.dev`.

### 1. Deploy the API worker

From the repository root:

```bash
cd backend/edu-api
pnpm install --frozen-lockfile
pnpm exec wrangler login
```

Set production secrets once (each command prompts for its value):

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production-ben
pnpm exec wrangler secret put LANGTRACE_API_KEY --env production-ben
pnpm exec wrangler secret put OPENROUTER_API_KEY --env production-ben
pnpm exec wrangler secret put R2_ACCESS_KEY_ID --env production-ben
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --env production-ben
pnpm exec wrangler secret put OPENROUTER_MODEL --env production-ben
```

Apply remote migrations, then deploy:

```bash
pnpm run db:migrate:remote:production-ben
pnpm run deploy:production-ben
```

### 2. Deploy the web worker

The web worker is configured in [`wrangler.jsonc`](./wrangler.jsonc) and
routes `edu.benapps.dev` to `edu-web-production-ben`.

```bash
cd ../../web
pnpm install --frozen-lockfile
pnpm run deploy:production-ben
```

Before deploying, provide these non-public values as Cloudflare Workers Build
variables (or in the deployment environment):

```text
BETTER_AUTH_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_TENANT_ID
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_DATABASE_ID
CLOUDFLARE_TOKEN
```

The production deploy script sets `NEXT_PUBLIC_API_URL` to
`https://edu-api.benapps.dev` and `NEXT_PUBLIC_BACKEND_URL` to
`https://edu.benapps.dev` before building the OpenNext bundle.

For a local Worker-runtime preview:

```bash
pnpm run preview
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to optimize and load Geist.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
