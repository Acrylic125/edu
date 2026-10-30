import { app, utilityProcess } from "electron"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

async function main() {
  await app.whenReady()
  const directory = await mkdtemp(join(tmpdir(), "edu-render-utility-"))
  const child = utilityProcess.fork(join(__dirname, "source-images-worker.js"), [directory, ...process.argv.slice(2)], { stdio: "pipe", serviceName: "EdU PDF rendering regression" })
  const stopped = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  let stderr = ""
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk))
  child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000) })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`PDF rendering test timed out: ${stderr}`)), 20_000)
      child.on("message", (message) => {
        if (!z.object({ type: z.literal("passed") }).safeParse(message).success) return
        clearTimeout(timer)
        resolve()
      })
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`PDF utility worker exited ${code}: ${stderr}`)) })
    })
    console.log("PASS: Electron utility process renders luminosity masks with correct pixels and reuses its cache.")
  } finally {
    child.kill()
    await stopped
    await rm(directory, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), (error: Error) => { console.error(error.message); app.exit(1) })
