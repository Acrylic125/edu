import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"

test("native agent workers spool Phoenix traces and install a portable exporter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-phoenix-native-"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const { ELECTRON_RUN_AS_NODE: _node, ELECTRON_RENDERER_URL: _renderer, ...environment } = process.env
  const app = await _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => typeof window.prune?.snapshot === "function")
    for (const provider of ["claude", "antigravity"] as const) {
      await expect.poll(async () => page.evaluate(async (provider) => {
        const snapshot = await window.prune?.snapshot()
        return snapshot?.providers.some((item) => item.id === provider && (item.loading || item.connecting))
      }, provider), { timeout: 30_000 }).toBe(false)
      const chatId = await page.evaluate(async ({ provider, executable }) => {
        const bridge = window.prune
        if (!bridge) throw new Error("Missing native bridge")
        await bridge.saveProvider({ id: provider, displayName: provider, binaryPath: executable, enabled: false })
        await bridge.connect(provider)
        const snapshot = await bridge.snapshot()
        const model = snapshot.providers.find((item) => item.id === provider)?.models[0]
        if (!model) throw new Error("The provider has no available models")
        const runnerId = await bridge.addRunner({ name: `${provider} trace test`, provider, model: model.id })
        const chatId = await bridge.createChat({ runnerId })
        await bridge.send({ chatId, content: "Teach me limits" })
        return chatId
      }, { provider, executable })
      await expect.poll(async () => page.evaluate(async (chatId) => {
        const snapshot = await window.prune?.snapshot()
        const chat = snapshot?.chats.find((item) => item.id === chatId)
        const runtime = snapshot?.runtime.find((item) => item.runnerId === chat?.runnerId)
        if (runtime?.error) return runtime.error
        return chat?.messages.at(-1)?.role
      }, chatId), { timeout: 20_000 }).toBe("assistant")
    }
    const phoenix = join(directory, "workspace", "phoenix")
    const files = await readdir(phoenix)
    expect(files).toEqual(expect.arrayContaining(["export_traces.py", "export_traces.py.lock", "README.md"]))
    const traces = files.filter((file) => file.endsWith(".otlp"))
    expect(traces.length).toBeGreaterThan(10)
    const bodies = await Promise.all(traces.map((file) => readFile(join(phoenix, file))))
    const contents = Buffer.concat(bodies).toString("utf8")
    expect(contents).toContain("runner.claude")
    expect(contents).toContain("runner.antigravity")
    expect(contents).toContain("tutor.run")
    expect(contents).toContain("turn.validate")
    expect(contents).toContain("harness.commit")
    expect(contents).not.toContain("Teach me limits")
    expect(contents).not.toContain("Here is your learning plan")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
