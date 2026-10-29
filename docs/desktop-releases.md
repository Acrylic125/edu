# Publish a desktop release

The `Release desktop` GitHub Actions workflow builds and tests EdU, prepares a
version, signs and notarizes macOS ARM64 installers, then creates a tag and release.
The workflow publishes only after all preparation jobs succeed.
Merging a pull request into `main` starts a release automatically. Direct pushes
to `main` and pull requests closed without merging do not start releases.
A newer release run cancels the previous release run.

Pull requests targeting `main` run a separate workflow in this order: build the
app, check the proposed release tag, then run tests. New commits and changes to
the PR title or description start a new check and cancel that PR's older check.
PR checks do not sign artifacts, create tags, or publish releases.

## Configure signing

Create a GitHub environment named `release`. Add these environment secrets:

- `MAC_CSC_LINK`: Base64-encoded `.p12` export of your Developer ID Application
  certificate, including its private key.
- `MAC_CSC_KEY_PASSWORD`: Password for the `.p12` export.
- `APPLE_ID`: Apple Account email used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password for that account.
- `APPLE_TEAM_ID`: Apple Developer team ID.

Keep your Apple Developer membership active for notarization. The workflow uses
[electron-builder's signing](https://www.electron.build/code-signing-mac.html)
and [notarization credentials](https://www.electron.build/docs/notarization/).

Repository rules must permit the workflow's `GITHUB_TOKEN` to create release
tags and GitHub releases. The workflow grants write access only to the publish job.

## Start a release

Merge a pull request into `main` to release using automatic version selection.
To start a release manually or override the version bump:

1. Open **Actions → Release desktop → Run workflow**.
2. Select the default branch with the changes you want to release.
3. Leave `bump` as `auto`, or select `patch`, `minor`, or `major`.
4. Start the workflow.

`auto` reads commit messages after the highest stable version tag reachable from
the selected commit. Both `0.1.0` and `v0.1.0` tag formats are accepted. Prerelease
tags are excluded. Without a stable tag, the base is `desktop/package.json`.

Version selection follows these rules:

- `fix:` or `fix(scope):` selects a patch release.
- `feat:` or `feat(scope):` selects a minor release.
- A Conventional Commit header with `!`, or a `BREAKING CHANGE:` footer, selects
  a major release.
- The largest bump across the commits wins. Other prefixes do not trigger a release.

Use Conventional Commit PR titles when squash-merging. If no commit requests a
release, `auto` fails. Select an explicit bump to release documentation or build
changes. Breaking changes also select a major bump while EdU is at `0.x`.

The PR tag check combines unreleased commits on the base branch with the PR title
and description. It excludes intermediate branch commits to match squash merges.
Configure squash-merge messages to include the PR title and description. Other
merge methods can produce a different release version because the merged commit
messages are used when the release runs.

The workflow embeds the selected version with electron-builder's
`extraMetadata.version`. It does not commit a version change to the source branch.
Published tags become the base for subsequent releases.

The workflow runs these stages in order:

1. Build the app, then run version-selection tests, unit tests, Electron tests,
   and rendering tests. Preserve the compiled app as an artifact.
2. Calculate the next version and tag name without creating a tag.
3. Package the tested app as a signed DMG and ZIP. Notarize and staple the app
   and DMG. Verify signatures, tickets, Gatekeeper acceptance, the packaged app,
   and the app inside the ZIP. Calculate checksums after stapling.
4. Download the prepared artifacts and verify checksums. Create an annotated tag
   at the tested commit. Create a draft release, upload artifacts, and publish it.

Find the DMG, ZIP, and `SHA256SUMS-macos-arm64.txt` on the GitHub release page.
This workflow publishes installers. EdU still needs an in-app updater to discover
and install releases automatically.

## Retry a failed release

Before tag creation, failures leave no release tag or GitHub release. If publishing
fails after tag creation, use **Re-run failed jobs** on the same workflow run.
The publish job accepts an existing tag only when it points at the tested commit.
It resumes a draft release and replaces incomplete uploads before publishing.
It refuses to modify an already published release.
Cancellation after tag creation can leave a tag or draft release. Resume that
run with **Re-run failed jobs** if you want to finish publishing those artifacts.

## Add Windows preparation

Add a Windows build and test job, then a `prepare-release-windows` job that depends
on both that job and `prepare-tag`. Package and sign the Windows installer using
`needs.prepare-tag.outputs.version`.

Upload the distributables as an artifact whose name starts with `release-`, and
include a platform-specific checksum file. Add the Windows preparation job to
`publish.needs` and verify its checksum file in the publish job. Keep artifact
filenames unique across platforms. Both platforms then share tag and release
creation, and a failure on either platform prevents publication.
