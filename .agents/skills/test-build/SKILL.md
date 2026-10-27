---
name: test-build
description: Use when testing a local EdU desktop build by rebuilding and reopening the app.
---

# Test Build

Build the EdU desktop app and reopen the existing app window to verify the fresh build.

1. Work in `desktop/` and run `pnpm build`. Wait for it to finish. If it fails, report the build output and do not launch the previous build as though it were current.
2. Quit the running EdU app before restarting it. Use the app's quit menu when possible; otherwise send a normal termination signal and wait for it to exit.
3. From `desktop/`, launch the app with `env -u ELECTRON_RUN_AS_NODE pnpm exec electron .`.
4. Bring the EdU window to the front and confirm it loaded `desktop/out/renderer/index.html` and shows the existing workspace.

Use the normal EdU data directory so the existing workspace remains available. Do not open Electron's default app page or start a fresh empty profile. Do not invoke or delegate to agents. This workflow builds and runs the local app; it does not create a release, installer, signature, or notarized package.
