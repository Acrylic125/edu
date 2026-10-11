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
    const topic = snapshot?.topics.find((topic) =>
      snapshot.runners.some(
        (runner) => runner.id === topic.runnerId && runner.provider === "codex",
      ),
    )
    if (!topic) throw new Error("No Codex topic to validate")
    const request = topic.messages.findLast(
      (message) => message.role === "user",
    )
    if (!request) throw new Error("No learner request to retry")
    await page.getByRole("button", { name: topic.title, exact: true }).click()
    await page.evaluate(
      async ({ topicId, content }) => window.prune?.send({ topicId, content }),
      { topicId: topic.id, content: request.content },
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            async (runnerId) =>
              (await window.prune?.snapshot())?.runtime.find(
                (state) => state.runnerId === runnerId,
              )?.status,
            topic.runnerId,
          ),
        { timeout: 240_000 },
      )
      .toMatch(/^(ready|error)$/)
    const completed = await page.evaluate(async () => window.prune?.snapshot())
    const runtime = completed?.runtime.find(
      (state) => state.runnerId === topic.runnerId,
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
    const savedTopic = saved.topics.find((entry) => entry.id === topic.id)
    expect(savedTopic?.messages.at(-1)?.role).toBe("assistant")
    expect(savedTopic?.messages.length).toBe(topic.messages.length + 2)
    expect(savedTopic?.learning.notes.trim()).not.toBe("")
    expect(savedTopic?.learning.workpad.trim()).not.toBe("")
    const notes = await readFile(
      join(directory, "topics", topic.id, "topic.md"),
      "utf8",
    )
    const workpad = await readFile(
      join(directory, "topics", topic.id, "agent.workpad.md"),
      "utf8",
    )
    expect(notes).toContain(savedTopic?.learning.notes)
    expect(workpad).toContain(savedTopic?.learning.workpad)
    const tracePath = join(
      directory,
      "topics",
      topic.id,
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
    await expect(
      page.getByRole("button", { name: "Open workspace in Finder" }),
    ).toBeVisible()
    await page.screenshot({ path: "test-results/live-codex-diagnostics.png" })
    console.info("Validated connected desktop turn", {
      model: saved.runners.find((runner) => runner.id === topic.runnerId)
        ?.model,
      topicId: topic.id,
      tracePath,
      replyCharacters: savedTopic?.messages.at(-1)?.content.length,
    })
  } finally {
    await app.close()
  }
})
