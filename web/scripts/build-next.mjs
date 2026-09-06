import { existsSync, readdirSync, renameSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const nextBin = path.join(appRoot, "node_modules/next/dist/bin/next")

execFileSync(process.execPath, [nextBin, "build", "--webpack"], {
  cwd: appRoot,
  stdio: "inherit",
})

// The monorepo tracing root nests standalone output under the app directory.
// OpenNext expects the standalone server at .next/standalone instead.
const standaloneRoot = path.join(appRoot, ".next/standalone")
const nestedRoot = path.join(standaloneRoot, path.basename(appRoot))

if (existsSync(nestedRoot)) {
  for (const entry of readdirSync(nestedRoot)) {
    renameSync(
      path.join(nestedRoot, entry),
      path.join(standaloneRoot, entry),
    )
  }
}
