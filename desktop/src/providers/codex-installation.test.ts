import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { resolveCodexExecutable } from "./codex-installation"

test("Codex discovery checks compatibility and preserves launcher paths", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-codex-discovery-"))
  const bundled = join(directory, "bundled", "codex")
  const local = join(directory, "local")
  const executable = join(local, "codex")
  const payload = join(directory, "launcher")
  await mkdir(local)
  try {
    assert.equal(await resolveCodexExecutable(bundled, [local]), bundled)
    await writeFile(payload, `#!/bin/sh
case "$1" in
  --version) echo 'codex-cli 0.164.0';;
  features) printf 'code_mode_host stable true\\nskip_host_skill_discovery experimental false\\n';;
  app-server) exit 0;;
  *) exit 1;;
esac
`, { mode: 0o755 })
    await symlink(payload, executable)
    assert.equal(await resolveCodexExecutable(bundled, [local]), executable)
    await writeFile(payload, "#!/bin/sh\necho 'codex-cli 0.159.0'\n")
    assert.equal(await resolveCodexExecutable(bundled, [local]), bundled)
    await writeFile(payload, "#!/bin/sh\necho 'codex-cli 0.164.0'\n")
    assert.equal(await resolveCodexExecutable(bundled, [local]), bundled, "Missing required features must fall back")
    await writeFile(payload, "#!/bin/sh\nexit 1\n")
    assert.equal(await resolveCodexExecutable(bundled, [local]), bundled)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an incomplete native Codex installation falls back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-codex-native-"))
  try {
    const name = process.platform === "win32" ? "codex.exe" : "codex"
    await writeFile(join(directory, name), "incomplete native install", { mode: 0o755 })
    assert.equal(await resolveCodexExecutable("bundled", [directory]), "bundled")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
