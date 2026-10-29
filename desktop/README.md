# Set up EdU desktop

For the architecture and tutor flow diagram, see the
[main README](../README.md).

## Run from source

Install Node.js 22.13 or later and pnpm 10.26.0. From `desktop/`, run:

```sh
pnpm --dir ../packages/ui install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm dev
```

Installation downloads Electron. Once the app opens, install a provider's CLI
and connect your account.

## Connect a provider

Packaged users can start here. No separate Node.js, Python, or tutoring skill
installation is required. Tutoring requires internet access and a provider
account with model access.

1. Open **Settings → Providers → Add provider**.
2. Choose a provider and complete its connection:
   - **Codex:** install [Codex CLI](https://developers.openai.com/codex/cli)
     version 0.162.1 or later, then recheck setup. Click **Connect** and finish
     browser sign-in with an account that has Codex access and available model credits.
   - **Claude:** install Claude Code if needed, then click **Connect**. EdU finds
     the CLI and starts sign-in if needed.
   - **Antigravity:** install its CLI if needed, then click **Connect**. The
     connection check sends a small model request.
3. Confirm that installation and account connection show checkmarks.
4. Start a chat and choose the provider and model beside the paperclip.

If EdU cannot find a CLI, use the installation refresh button. For a custom
installation, open **Advanced settings**, set **Binary path** to the executable's
absolute path, and click **Save changes**. Reconnect after changing a CLI binary.
Leave the Codex binary path empty to detect a compatible installed CLI.
EdU does not bundle or download Codex.

For visual sources, choose Codex with a vision-capable model. Claude Code and
Antigravity support text and extracted PDF text.

## Run checks

From `desktop/`, run:

```sh
pnpm typecheck
pnpm test
pnpm test:smoke
```

`test:smoke` builds the app and runs Playwright against Electron.

## Build an installer

From `desktop/`, run:

```sh
pnpm build
pnpm package
```

Find the distributable in `desktop/release/`: macOS DMG and ZIP, Windows NSIS,
or Linux AppImage. Build on the target operating system and architecture.
For a signed release, configure signing credentials and macOS notarization
before packaging.

For GitHub releases, follow [Publish a desktop release](../docs/desktop-releases.md).

To create a local app bundle without macOS signing, run `pnpm package:dir`.

## Use a separate development workspace

Set an absolute user-data path when starting the app:

```sh
EDU_DATA_DIR='/absolute/path/to/edu-dev' pnpm dev
```

## Preview the renderer

From `desktop/`, run `pnpm dev:renderer` and open `http://localhost:5174`.
Use Electron for provider connections and tutor runs.

## Set up trace inspection

Follow the [Phoenix exporter guide](../phoenix/README.md) to start a local
Phoenix instance and upload saved traces. Phoenix is optional for running EdU.
