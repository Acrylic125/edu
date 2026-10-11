import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const codexPackage = require.resolve("@openai/codex/package.json")
const codexRequire = createRequire(codexPackage)
const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
}
const platform = `${process.platform}-${process.arch}`
const target = targets[platform]
if (!target) throw new Error(`Codex does not support ${platform}.`)
const nativePackage = codexRequire.resolve(
  `@openai/codex-${platform}/package.json`,
)
const destination = resolve("resources/codex")
await mkdir(destination, { recursive: true })
await rm(join(destination, "bin"), { force: true, recursive: true })
await cp(join(dirname(nativePackage), "vendor", target), destination, {
  recursive: true,
})
const metadata = JSON.parse(await readFile(codexPackage, "utf8"))
await writeFile(join(destination, "version.txt"), metadata.version + "\n")
