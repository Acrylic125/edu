# EdU

EdU ships as a standalone Electron tutoring app. The deprecated web app and its
legacy deployment workflow have been removed.

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
boundaries. The repository contains the desktop app, its shared UI package, and
an Astro landing page.

## Landing page

```sh
pnpm --dir landing install --frozen-lockfile
pnpm landing:dev
pnpm landing:build
```

See [landing/README.md](landing/README.md) for checks and button link configuration.
