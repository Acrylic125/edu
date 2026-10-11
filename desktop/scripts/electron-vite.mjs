import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"

const require = createRequire(import.meta.url)
const entry = resolve(
  dirname(require.resolve("electron-vite")),
  "../bin/electron-vite.js",
)
// Hosts built on Electron sometimes inherit Node mode; the desktop child must launch as an app.
const { ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment,
})
child.on("error", (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
