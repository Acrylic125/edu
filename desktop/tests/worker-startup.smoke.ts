import { resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"

test("the built tutor worker starts in an Electron utility process", async () => {
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({
    args: [resolve("tests/fixtures/worker-host.cjs")],
    env: Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  })
  try {
    const result = await app.evaluate(({ utilityProcess }, workerPath) => new Promise<{ type: string; error?: string }>((resolve, reject) => {
      const child = utilityProcess.fork(workerPath, [], { stdio: "pipe" })
      let stderr = ""
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString() })
      child.on("message", (message) => {
        resolve(message)
        child.kill()
      })
      child.on("exit", (code) => reject(new Error(`Worker exited (${code}): ${stderr}`)))
      // A schema error confirms that startup completed and the real message handler is running.
      child.postMessage({})
    }), resolve("out/main/worker.js"))
    expect(result.type).toBe("error")
    expect(result.error).toContain("invalid_type")
  } finally {
    await app.close()
  }
})
