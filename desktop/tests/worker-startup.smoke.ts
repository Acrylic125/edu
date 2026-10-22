import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { _electron, expect, test } from "@playwright/test"
import { newChat } from "../src/main/workspace"
import { WorkerEventSchema, WorkerJobSchema } from "../src/shared/contracts"

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

for (const provider of ["claude", "antigravity"] as const) {
  test(`${provider} executes native study-tool calls from the built Electron worker`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "edu-native-worker-"))
    const executable = resolve("tests/fixtures/provider-cli.mjs")
    await chmod(executable, 0o755)
    const chat = newChat(randomUUID())
    chat.messages.push({ id: randomUUID(), role: "user", content: "Teach me limits", createdAt: new Date().toISOString(), topicIds: [] })
    const job = WorkerJobSchema.parse({
      chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "fixture" },
      cli: { provider, executable, directory },
      skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory,
    })
    const { ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
    const app = await _electron.launch({ args: [resolve("tests/fixtures/worker-host.cjs")], env: Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)) })
    try {
      const result = await app.evaluate(({ utilityProcess }, { workerPath, job }) => new Promise((resolve, reject) => {
        const child = utilityProcess.fork(workerPath, [], { stdio: "pipe" })
        let stderr = ""
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString() })
        child.on("message", (message) => {
          if (message.type !== "result" && message.type !== "error") return
          resolve(message)
          child.kill()
        })
        child.on("exit", (code) => reject(new Error(`Worker exited (${code}): ${stderr}`)))
        child.postMessage(job)
      }), { workerPath: resolve("out/main/worker.js"), job })
      expect(WorkerEventSchema.parse(result)).toMatchObject({
        type: "result", reply: expect.stringContaining("Confirm it"), learning: { phase: "awaiting_plan_confirmation" },
      })
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}
