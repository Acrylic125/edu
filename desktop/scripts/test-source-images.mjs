import { spawn } from "node:child_process"
import electron from "electron"

const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
const argumentsList = process.argv.slice(2)
if (argumentsList[0] === "--") argumentsList.shift()
const child = spawn(electron, [".test-out/source-images.js", ...argumentsList], { stdio: "inherit", env: environment })
child.on("error", (error) => { console.error(error); process.exitCode = 1 })
child.on("exit", (code) => { process.exitCode = code ?? 1 })
