#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_VERSION:?Missing release version}"
: "${CSC_LINK:?Missing Developer ID Application certificate}"
: "${CSC_KEY_PASSWORD:?Missing certificate password}"
: "${APPLE_ID:?Missing Apple ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Missing notarization password}"
: "${APPLE_TEAM_ID:?Missing Apple team ID}"
test "$(uname -m)" = arm64

pnpm exec electron-builder --mac dmg zip --arm64 --publish never \
  --config.directories.output=release/signed \
  --config.extraMetadata.version="$RELEASE_VERSION" \
  --config.forceCodeSigning=true \
  --config.mac.notarize=true \
  --config.dmg.sign=true

app="release/signed/mac-arm64/EdU.app"
dmg="release/signed/EdU-${RELEASE_VERSION}-arm64.dmg"
zip="release/signed/EdU-${RELEASE_VERSION}-arm64-mac.zip"
codesign --verify --deep --strict "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"
pnpm test:packaged "$app/Contents/Resources/app.asar"
test ! -e "$app/Contents/Resources/resources/codex"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$RELEASE_VERSION"

xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait --output-format json > release/signed/dmg-notarization.json
test "$(plutil -extract status raw -o - release/signed/dmg-notarization.json)" = Accepted
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
codesign --verify --strict "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
unzip -t "$zip"

zip_check=$(mktemp -d)
trap 'rm -rf "$zip_check"' EXIT
ditto -x -k "$zip" "$zip_check"
codesign --verify --deep --strict "$zip_check/EdU.app"
xcrun stapler validate "$zip_check/EdU.app"

mkdir -p release/prepared
cp "$dmg" "$zip" release/prepared/
cp "$dmg" release/prepared/EdU-mac-arm64.dmg
node scripts/prepare-update-manifest.mjs release/signed release/prepared "$RELEASE_VERSION"
# Stapling changes the DMG bytes, so calculate checksums only after verification.
(cd release/prepared && shasum -a 256 ./*.dmg ./*.zip ./*.blockmap ./latest-mac.yml > SHA256SUMS-macos-arm64.txt)
