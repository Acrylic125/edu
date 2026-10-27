# EdU landing

Static Astro landing page using the desktop’s shared theme and book artwork.

```sh
pnpm --dir landing install --frozen-lockfile
pnpm landing:dev
pnpm landing:check
pnpm landing:build
```

The development server runs at `http://localhost:4321`. The production site is
generated in `landing/dist`.

Set the Electron download URL with the `DOWNLOAD_URL` environment variable, or
set it in `src/links.ts`. The skill URL remains configured in `src/links.ts`.
Each button is disabled until its URL is set; configured buttons render as
links. Rebuild after changing URLs.
