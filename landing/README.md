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

The download button uses GitHub's latest-release URL for `EdU-mac-arm64.dmg`.
The desktop release workflow publishes that fixed asset name alongside the
versioned installers. After this landing-page change is deployed and a release
with that asset is published, each new release updates the download target
without a Vercel rebuild or environment-variable change. `DOWNLOAD_URL` is no
longer used.

The skill URL remains configured in `src/links.ts`.
