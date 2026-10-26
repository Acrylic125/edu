import { spawn } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import electron from "electron"

let output = "linux-unpacked"
if (process.arch !== "x64") output = `linux-${process.arch}-unpacked`
if (process.platform === "win32") {
  output = "win-unpacked"
  if (process.arch !== "x64") output = `win-${process.arch}-unpacked`
}
let archive = join("release", output, "resources", "app.asar")
if (process.platform === "darwin") {
  output = "mac"
  if (process.arch !== "x64") output = `mac-${process.arch}`
  archive = join("release", output, "EdU.app", "Contents", "Resources", "app.asar")
}

const {
  ELECTRON_RUN_AS_NODE: _runAsNode,
  NODE_PATH: _nodePath,
  NODE_OPTIONS: _nodeOptions,
  ...environment
} = process.env
const archivePath = resolve(process.argv[2] ?? archive)
const checks = [
  [resolve("test/packaged-runner.cjs"), archivePath],
  [resolve(".test-out/workflow.js"), join(archivePath, "out/main/worker.js"), join(dirname(archivePath), "resources/tutor-me")],
]

try {
  for (const args of checks) {
    await new Promise((resolve, reject) => {
      const child = spawn(electron, args, { stdio: "inherit", env: environment })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Packaged application check exited (${code}).`))
      })
    })
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
