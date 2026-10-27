---
name: release-desktop
description: Build, sign, and notarize EdU desktop release installers. Use for desktop releases, not ordinary development builds.
---

1. **Check prerequisites.** Inspect `git status --short`, `desktop/package.json`, and `desktop/electron-builder.yml`. Use the host architecture. On macOS, verify a Developer ID Application identity with `security find-identity -v -p codesigning` and existing credentials with `xcrun notarytool history --keychain-profile EdU-Notarization --output-format json`. Keep Codex CLI excluded from release resources and dependencies.

2. **Rebuild.** From `desktop/`, run `pnpm build`. Continue only after it passes.

3. **Sign and notarize the app.** From `desktop/`, run:

   ```sh
   APPLE_KEYCHAIN_PROFILE=EdU-Notarization pnpm exec electron-builder --mac dmg zip \
     --config.directories.output=release/signed \
     --config.forceCodeSigning=true \
     --config.mac.notarize=true \
     --config.dmg.sign=true
   ```

   Require successful Developer ID signing and notarization. The resulting ZIP must contain the stapled app.

4. **Notarize and staple the DMG.** Set `dmg_path` to the generated DMG, then run:

   ```sh
   xcrun notarytool submit "$dmg_path" --keychain-profile EdU-Notarization --wait --output-format json
   xcrun stapler staple "$dmg_path"
   xcrun stapler validate "$dmg_path"
   ```

   Staple only after `Accepted`. Retain submission IDs; resume interrupted submissions rather than uploading duplicates. Inspect Apple's log if rejected.

5. **Verify and deliver.** Verify app and DMG signatures with `codesign --verify` (add `--deep --strict` for the app), app ticket with `xcrun stapler validate`, and Gatekeeper with `spctl --assess --type execute --verbose=2`. Check ZIP integrity and the enclosed app's signature and ticket. Confirm version, architecture, and absence of bundled Codex CLI; run relevant packaged checks. Link the DMG and ZIP, report each download size and installed app size, and confirm signing, notarization, and stapling results.
