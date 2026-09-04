# Development tools

Private npm packages used to diagnose the application during development.

## Setup

```bash
cd tools
cp .env.example .env
pnpm install
```

Set `LANGTRACE_API_KEY` in `.env`. The key must be a project-level API key.

## Langtrace

Retrieve every span for one trace and print the raw trace as formatted JSON:

```bash
pnpm langtrace <trace-id>
```

The tool resolves the Langtrace project from the API key, then downloads trace
pages until it finds an exact trace ID. Set `LANGTRACE_API_HOST` when using a
self-hosted Langtrace instance.
