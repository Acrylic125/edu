import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("./prepare-release.mjs", import.meta.url))

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "edu-release-"))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
  git("init", "-q")
  git("config", "user.name", "Release test")
  git("config", "user.email", "release@example.com")
  mkdirSync(join(cwd, "desktop"))
  writeFileSync(join(cwd, "desktop/package.json"), JSON.stringify({ version: "0.1.0" }))
  git("add", ".")
  git("commit", "-qm", "chore: initial commit")
  const run = (bump = "auto", environment = {}) => spawnSync(process.execPath, [script, bump], {
    cwd, encoding: "utf8", env: {
      ...process.env, GITHUB_OUTPUT: "", ...environment,
    },
  })
  return { cwd, git, run }
}

test("first release uses the package version as its base", (t) => {
  const { git, run } = repository(t)
  git("commit", "--allow-empty", "-qm", "fix: repair startup")
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^version=0\.1\.1\ntag=v0\.1\.1\nbase_tag=\n/)
})

test("highest change wins and commits before the latest stable tag are excluded", (t) => {
  const { git, run } = repository(t)
  git("commit", "--allow-empty", "-qm", "feat!: old breaking change")
  git("tag", "0.9.0")
  git("tag", "v1.4.2")
  git("commit", "--allow-empty", "-qm", "fix: repair startup")
  git("tag", "v2.0.0-beta.1")
  git("commit", "--allow-empty", "-qm", "feat(import): import PDF")
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^version=1\.5\.0\ntag=v1\.5\.0\nbase_tag=v1\.4\.2\n/)
})

for (const message of ["feat(api)!: remove old API", "refactor: change format\n\nBREAKING CHANGE: old files need migration"]) {
  test(`breaking marker selects major: ${message.split("\n")[0]}`, (t) => {
    const { git, run } = repository(t)
    git("tag", "v1.4.2")
    git("commit", "--allow-empty", "-qm", message)
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^version=2\.0\.0\n/)
  })
}

test("documentation-only changes require an explicit bump", (t) => {
  const { git, run } = repository(t)
  git("tag", "v1.4.2")
  git("commit", "--allow-empty", "-qm", "docs: update guide")
  assert.notEqual(run().status, 0)
  const result = run("patch")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^version=1\.4\.3\n/)
})

test("rejects a version already tagged on another branch", (t) => {
  const { git, run } = repository(t)
  git("tag", "v1.4.2")
  git("checkout", "-qb", "other")
  git("commit", "--allow-empty", "-qm", "fix: other branch")
  git("tag", "v1.4.3")
  git("checkout", "-q", "-")
  git("commit", "--allow-empty", "-qm", "fix: current branch")
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /already has a tag/)
})

test("PR checks use the squash message and unreleased base commits", (t) => {
  const { git, run } = repository(t)
  git("tag", "v1.4.2")
  git("commit", "--allow-empty", "-qm", "feat: unreleased base feature")
  const base = git("rev-parse", "HEAD")
  git("checkout", "-qb", "pull-request")
  git("commit", "--allow-empty", "-qm", "feat!: abandoned intermediate change")
  const result = run("auto", {
    RELEASE_PR_BASE_SHA: base,
    RELEASE_PR_TITLE: "fix: repair startup",
    RELEASE_PR_BODY: "Keep existing interfaces.",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^version=1\.5\.0\n/)
  assert.equal(git("tag", "--list", "v1.5.0"), "")
  assert.equal(git("status", "--porcelain"), "")
})

test("PR description breaking footer selects major", (t) => {
  const { git, run } = repository(t)
  git("tag", "v1.4.2")
  const result = run("auto", {
    RELEASE_PR_BASE_SHA: git("rev-parse", "HEAD"),
    RELEASE_PR_TITLE: "refactor: simplify file format",
    RELEASE_PR_BODY: "BREAKING CHANGE: migrate existing files.",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^version=2\.0\.0\n/)
})
