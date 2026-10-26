import { spawn } from "node:child_process"
import electron from "electron"

const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
const child = spawn(electron, [".test-out/workflow.js", ...process.argv.slice(2)], { stdio: "inherit", env: environment })
child.on("error", (error) => { console.error(error); process.exitCode = 1 })
child.on("exit", (code) => { process.exitCode = code ?? 1 })
