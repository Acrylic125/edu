import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

test("release preparation emits an updater manifest matching the final ZIP and copies its blockmap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-update-"))
  try {
    const source = join(directory, "signed")
    const destination = join(directory, "prepared")
    await mkdir(source)
    await mkdir(destination)
    const name = "EdU-0.2.0-arm64-mac.zip"
    const bytes = Buffer.from("signed and notarized ZIP payload")
    await writeFile(join(source, name), bytes)
    await writeFile(join(source, `${name}.blockmap`), "blockmap")
    execFileSync(process.execPath, [new URL("./prepare-update-manifest.mjs", import.meta.url).pathname, source, destination, "0.2.0"])
    const manifest = JSON.parse(await readFile(join(destination, "latest-mac.yml"), "utf8"))
    assert.equal(manifest.version, "0.2.0")
    assert.deepEqual(manifest.files, [{ url: name, sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length }])
    assert.equal(await readFile(join(destination, `${name}.blockmap`), "utf8"), "blockmap")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
