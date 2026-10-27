import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { resolveCodexExecutable } from "./codex-installation"

test("Codex discovery checks compatibility and preserves launcher paths", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-codex-discovery-"))
  const local = join(directory, "local")
  const executable = join(local, "codex")
  const payload = join(directory, "launcher")
  await mkdir(local)
  try {
    await assert.rejects(resolveCodexExecutable(undefined, [local]), /Install or update Codex CLI/)
    await writeFile(payload, `#!/bin/sh
case "$1" in
  --version) echo 'codex-cli 0.164.0';;
  features) printf 'code_mode_host stable true\\nskip_host_skill_discovery experimental false\\n';;
  app-server) exit 0;;
  *) exit 1;;
esac
`, { mode: 0o755 })
    await symlink(payload, executable)
    assert.equal(await resolveCodexExecutable(undefined, [local]), executable)
    assert.equal(await resolveCodexExecutable(executable, []), executable)
    await assert.rejects(resolveCodexExecutable(join(directory, "missing"), [local]), /Install or update Codex CLI/)
    await writeFile(payload, "#!/bin/sh\necho 'codex-cli 0.159.0'\n")
    await assert.rejects(resolveCodexExecutable(undefined, [local]), /Install or update Codex CLI/)
    await writeFile(payload, "#!/bin/sh\necho 'codex-cli 0.164.0'\n")
    await assert.rejects(resolveCodexExecutable(undefined, [local]), /Install or update Codex CLI/, "Missing required features must show setup instructions")
    await writeFile(payload, "#!/bin/sh\nexit 1\n")
    await assert.rejects(resolveCodexExecutable(undefined, [local]), /Install or update Codex CLI/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an incomplete native Codex installation requires setup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-codex-native-"))
  try {
    const name = process.platform === "win32" ? "codex.exe" : "codex"
    await writeFile(join(directory, name), "incomplete native install", { mode: 0o755 })
    await assert.rejects(resolveCodexExecutable(undefined, [directory]), /Install or update Codex CLI/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
