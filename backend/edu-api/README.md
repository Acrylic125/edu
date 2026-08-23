# edu-api

## Production (`env.production-ben`)

Put secrets remotely (one prompt each):

```sh
pnpx wrangler secret put BETTER_AUTH_SECRET --env production-ben
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
        "origins": ["http://localhost:3000", "https://benapps.dev"],
        "methods": ["GET", "PUT", "HEAD"],
        "headers": ["Content-Type"]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
EOF
```
