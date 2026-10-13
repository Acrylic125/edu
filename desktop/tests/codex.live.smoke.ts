import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"
import { WorkspaceSchema, TraceEventSchema } from "../src/shared/contracts"

const environment = z
  .object({
    PRUNE_LIVE_DATA_DIR: z.string().optional(),
    PRUNE_PACKAGED_APP: z.string().optional(),
  })
  .parse(process.env)

test("connected packaged Codex commits a real reply, notes, and diagnostics", async () => {
  test.skip(
    !environment.PRUNE_LIVE_DATA_DIR || !environment.PRUNE_PACKAGED_APP,
    "Live account validation must be explicitly enabled",
  )
  test.setTimeout(300_000)
  if (!environment.PRUNE_LIVE_DATA_DIR || !environment.PRUNE_PACKAGED_APP)
    throw new Error("Missing live validation environment")
  const {
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ELECTRON_RENDERER_URL: _rendererUrl,
    ...inherited
  } = process.env
  const app = await _electron.launch({
    executablePath: environment.PRUNE_PACKAGED_APP,
    env: { ...inherited, PRUNE_DATA_DIR: environment.PRUNE_LIVE_DATA_DIR },
  })
  try {
    const page = await app.firstWindow()
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (await window.prune?.snapshot())?.providers.find(
                (provider) => provider.id === "codex",
              )?.connected,
          ),
        { timeout: 30_000 },
      )
      .toBe(true)
    const snapshot = await page.evaluate(async () => window.prune?.snapshot())
    const chat = snapshot?.chats.find((chat) =>
      snapshot.runners.some(
        (runner) => runner.id === chat.runnerId && runner.provider === "codex",
      ),
    )
    if (!chat) throw new Error("No Codex chat to validate")
    const request = chat.messages.findLast(
      (message) => message.role === "user",
    )
    if (!request) throw new Error("No learner request to retry")
    await page.getByRole("tab", { name: chat.title, exact: true }).click()
    await page.evaluate(
      async ({ chatId, content }) => window.prune?.send({ chatId, content }),
      { chatId: chat.id, content: request.content },
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            async (runnerId) =>
              (await window.prune?.snapshot())?.runtime.find(
                (state) => state.runnerId === runnerId,
              )?.status,
            chat.runnerId,
          ),
        { timeout: 240_000 },
      )
      .toMatch(/^(ready|error)$/)
    const completed = await page.evaluate(async () => window.prune?.snapshot())
    const runtime = completed?.runtime.find(
      (state) => state.runnerId === chat.runnerId,
    )
    expect(runtime?.error).toBeUndefined()
    expect(runtime?.status).toBe("ready")
    expect(runtime?.traceId).toBeDefined()
    if (!environment.PRUNE_LIVE_DATA_DIR)
      throw new Error("Missing live data directory")
    const directory = join(environment.PRUNE_LIVE_DATA_DIR, "workspace")
    const saved = WorkspaceSchema.parse(
      JSON.parse(await readFile(join(directory, "workspace.json"), "utf8")),
    )
    const savedChat = saved.chats.find((entry) => entry.id === chat.id)
    expect(savedChat?.messages.at(-1)?.role).toBe("assistant")
    expect(savedChat?.messages.length).toBe(chat.messages.length + 2)
    expect(savedChat?.learning.workpad.trim()).not.toBe("")
    const tracePath = join(
      directory,
      "chats",
      chat.id,
      "diagnostics",
      `${runtime?.traceId}.jsonl`,
    )
    const trace = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => TraceEventSchema.parse(JSON.parse(line)))
    expect(
      trace.some(
        (entry) =>
          entry.event === "tool.result" &&
          entry.details.tool === "save_learning_state" &&
          entry.details.success,
      ),
    ).toBe(true)
    expect(trace.some((entry) => entry.event === "harness.committed")).toBe(
      true,
    )
    await expect(page.getByText(/^Diagnostics ·/)).toHaveCount(0)
    await page.screenshot({ path: "test-results/live-codex-diagnostics.png" })
    console.info("Validated connected desktop turn", {
      model: saved.runners.find((runner) => runner.id === chat.runnerId)
        ?.model,
      chatId: chat.id,
      tracePath,
      replyCharacters: savedChat?.messages.at(-1)?.content.length,
    })
  } finally {
    await app.close()
  }
})
