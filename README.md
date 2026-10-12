# EdU

EdU ships as a standalone Electron tutoring app. The web version is paused and is
not part of the release. The legacy production deployment workflow is disabled;
web deployment and upload commands exit with an explanation.

## Desktop development

```sh
pnpm --dir packages/ui install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm desktop:dev
```

```sh
pnpm desktop:test
pnpm desktop:build
pnpm --dir desktop test:smoke
pnpm desktop:package
```

Open Settings for Appearance and Providers. ChatGPT uses the bundled Codex
runtime; OpenRouter connects through browser sign-in. Claude and Antigravity use
your installed, signed-in CLI, configured with an absolute binary path.

See [desktop/README.md](desktop/README.md) for account setup, packaging, and harness
boundaries. The backend and Next.js source remain available for future work.
