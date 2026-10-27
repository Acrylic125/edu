# Sign and notarize macOS releases

Read this reference only when the user authorizes signing or notarization. Commands run from `desktop/`. Derive app and artifact names from the current configuration and version rather than copying names from a previous release.

## Check the local credentials

Inspect available signing identities:

```sh
security find-identity -v -p codesigning
```

Use a valid **Developer ID Application** identity for distribution outside the Mac App Store. With one matching identity, electron-builder can discover it automatically. If you must set `mac.identity`, use the identifying name without the `Developer ID Application:` prefix; electron-builder rejects that prefix in an explicit name. Verify the selected identity in the build output.

For notarization, use an existing `notarytool` Keychain profile. The profile used on this project's current development Mac is `EdU-Notarization`; it is machine-local, so verify its availability instead of assuming another checkout has its credentials:

```sh
xcrun notarytool history --keychain-profile "EdU-Notarization" --output-format json
```

If the profile is absent or invalid, ask for its correct name or have the user run this command in their own terminal:

```sh
xcrun notarytool store-credentials "EdU-Notarization"
```

The interactive prompts collect the Apple account, app-specific password, and team. Use the team associated with the signing certificate. Keep passwords out of chat, command arguments, shell history, repository files, and logs. An app-specific password is created in the Apple account; the signing certificate does not supply it. Reuse a working Keychain profile without requesting credentials again.

## Sign without notarizing

After the production build, create the signed artifacts with notarization explicitly disabled, even if Apple credentials are already configured:

```sh
pnpm exec electron-builder --mac dmg zip \
  --config.directories.output=release/signed \
  --config.forceCodeSigning=true \
  --config.mac.notarize=false \
  --config.dmg.sign=true
```

`forceCodeSigning` prevents a missing identity from silently producing an unsigned release. `dmg.sign` signs the disk image as well as the app. Signing changes invalidate prior notarization results for the changed code; perform notarization after the final signature.

## Build, sign, and notarize together

When the user authorizes all stages, let electron-builder notarize and staple the signed app before creating its distributable archives:

```sh
pnpm build
APPLE_KEYCHAIN_PROFILE=EdU-Notarization pnpm exec electron-builder --mac dmg zip \
  --config.directories.output=release/signed \
  --config.forceCodeSigning=true \
  --config.mac.notarize=true \
  --config.dmg.sign=true
```

Use the verified profile name if it differs. A `skipped macOS notarization` message means notarization did not happen; resolve the stated cause before claiming success. Preserve the running process and any submission ID across interruptions instead of submitting the same artifact again.

The resulting ZIP contains the stapled app. A ZIP cannot itself be stapled, and repackaging an already notarized, stapled app does not require another ZIP submission. Verify the app's ticket and signature instead.

To staple a ticket to the DMG container too, submit the final signed DMG separately and record the returned submission ID:

```sh
xcrun notarytool submit "$dmg_path" \
  --keychain-profile "EdU-Notarization" --wait --output-format json
```

Set `dmg_path` to the actual generated file. After Apple returns `Accepted`, run:

```sh
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
```

## Notarize an existing signed app

If the user requests notarization of an existing signed artifact, use that artifact instead of rebuilding it. Verify its signature first. For an app bundle, create a temporary ZIP with `ditto -c -k --sequesterRsrc --keepParent`, submit it with `notarytool`, wait for `Accepted`, then staple the original app. Create the distribution ZIP from that stapled app. For a signed DMG, submit and staple it directly.

Stapling preserves the code signature. Rebuilding or re-signing code after acceptance requires a new submission for the changed code.

## Handle Apple's result

Upload and review can be quiet for several minutes. While a command is running, retain its process/session ID and share progress at reasonable intervals. To resume a known submission, use `notarytool info` or `notarytool wait` with its submission ID and Keychain profile; do not create a duplicate submission.

- **Accepted:** staple the supported artifact and validate its ticket.
- **In Progress:** continue the existing wait within the current task, or report the pending ID if the user stops or postpones the work. Do not call it completed.
- **Invalid/rejected:** fetch `xcrun notarytool log` with that ID and profile, inspect the actual rejection, fix its cause, and submit the changed artifact once.

An unchanged submission that is already rejected should not be resubmitted. If credentials or an external Apple issue block progress, report the specific blocker and retain the submission ID.

## Verify the final release

Set `app_path` and `dmg_path` to the actual final artifacts. For the app:

```sh
codesign --verify --deep --strict --verbose=2 "$app_path"
codesign -dv --verbose=4 "$app_path"
```

Check the expected Developer ID authority, team, bundle identifier, and hardened runtime. If the DMG was signed, verify it with `codesign --verify --verbose=2 "$dmg_path"` too.

For a notarized app:

```sh
xcrun stapler validate "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
```

Validate a stapled DMG with `xcrun stapler validate "$dmg_path"`. Check ZIP integrity and, when needed, extract it to a temporary directory and verify the enclosed app's signature and ticket. Report these states separately: app signed, app notarized/stapled, DMG signed, and DMG notarized/stapled. App notarization does not establish that the outer DMG has its own ticket.
