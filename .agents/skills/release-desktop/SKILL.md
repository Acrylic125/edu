---
name: release-desktop
description: "Prepare EdU desktop releases when explicitly requested, including release installers, signing, and notarization. Exclude ordinary app builds and packaging cleanup."
---

# Release EdU desktop

Use this workflow only when the user asks to prepare or package a release, produce release installers, sign, or notarize. For a plain app build request, run `pnpm build` from `desktop/` and finish at the compiled app output. Ordinary builds and packaging cleanup do not invoke this skill or expand into release preparation.

## Choose the authorized stage

Use the latest user instruction to choose the stage:

- **Bundle:** build and produce an unsigned installer or app directory. This is the default for release requests and for invoking this skill without a stage.
- **Sign:** sign the release with a Developer ID certificate, with notarization disabled.
- **Notarize:** submit signed code to Apple, wait for acceptance, and staple its ticket.

A request to sign and notarize authorizes both stages without another confirmation. A request to prepare, inspect, reduce size, or create this skill authorizes neither. If the user has postponed signing or notarization, continue with unsigned preparation until they explicitly resume those stages. If interrupted, stop the active release process and inspect its state before resuming; an Apple submission already sent cannot be canceled by stopping the local process.

## Inspect the checkout

Locate the repository root and inspect `git status --short`. Preserve unrelated work. Read these files for the current scripts, version, product name, targets, and resource filters:

- `desktop/package.json`
- `desktop/electron-builder.yml`
- `desktop/README.md`

Build on the target operating system and architecture. Use the host architecture unless the user requests another supported target. macOS signing and notarization require a Mac with Xcode command-line tools; use [references/macos.md](references/macos.md) only for those stages.

Codex CLI is a separately installed provider runtime. Keep it out of release resources and production dependencies. Confirm the configuration excludes stale `desktop/resources/codex/` content left from earlier builds, and that no install, development, or build script recreates the bundle. Preserve the provider's CLI detection, compatibility checks, and installation instructions.

Keep this skill and its references under `.agents/skills/release-desktop/`. Credentials, certificates, generated installers, and notarization logs belong outside tracked skill files. A request for a Git-storable skill does not itself request a commit.

## Build and package without signing

Run commands from `desktop/`. Use `pnpm build`; inspect the script first because it currently includes type checking. Run checks relevant to any code changes. The package scripts may also run packaged tests, and some script names enable automatic signing: use explicit `electron-builder` options when the authorized stage is unsigned.

For a macOS DMG and ZIP:

```sh
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg zip \
  --config.directories.output=release/unsigned \
  --config.mac.identity=null \
  --config.mac.notarize=false \
  --config.dmg.sign=false
```

For an app directory, replace `--mac dmg zip` with `--mac --dir`. For another platform, select the configured native target and use a separate unsigned output directory.

Keep unsigned and signed outputs separate so a preparation run cannot replace a verified release. Check for an existing process before retrying a command whose result was interrupted. Do not start signing or notarization to finish an unsigned packaging request.

## Verify the artifact

Verify the generated files rather than relying only on a successful build exit:

1. Confirm the expected version, platform, architecture, and artifact paths.
2. Inspect the app resources for the absence of the Codex CLI bundle and its native executables. On macOS, check `Contents/Resources/resources/codex` and the packaged dependency manifest. Provider icons and EdU's own Codex integration code are expected.
3. Run the existing packaged checks when packaging code or resource changes need validation. Inspect the relevant package script first; these checks do not require signing.
4. Report installed app size separately from each compressed installer size. DMG and ZIP are alternative downloads, not additive installation requirements. Inspect large resource directories if size is unexpected.
5. For authorized signing or notarization, complete the corresponding verification in the macOS reference. Report a pending or rejected submission as such.

Finish with links to the artifacts, measured sizes, checks performed, and the actual signing and notarization state. If only unsigned preparation was authorized, stop there. Publishing, uploading to a release host, or changing website downloads requires its own user instruction.
