import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("copies user and assistant messages to the native clipboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-chat-copy-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const runnerId = randomUUID()
  const messages = [
    { role: "user" as const, content: "Explain finite automata → with an example." },
    { role: "assistant" as const, durationMs: 2500, content: "**Finite automata**\n\n1. Start at q₀.\n2. Read each symbol." },
  ]
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.load()
  await repository.mutate((state) => {
    state.runners.push({ id: runnerId, name: "Tutor", provider: "claude", model: "default" })
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push({
      ...newChat(runnerId, "Clipboard check"),
      messages: messages.map((message) => ({
        ...message,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        topicIds: [],
      })),
    })
  })
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...environment
  } = process.env
  const app = await _electron.launch({
    args: [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const page = await app.firstWindow()
    const assistant = page.locator('[data-message-role="assistant"]')
    const user = page.locator('[data-message-role="user"]')
    const duration = assistant.getByLabel("Response duration")
    await expect(duration).toHaveText("2.5s")
    await expect(duration).toBeVisible()
    await expect(user.getByLabel("Response duration")).toHaveCount(0)
    const rows = await page.locator("[data-message-role]").evaluateAll((rows) => rows.map((row) => ({
      top: row.getBoundingClientRect().top,
      bottom: row.getBoundingClientRect().bottom,
      paddingTop: getComputedStyle(row).paddingTop,
      paddingBottom: getComputedStyle(row).paddingBottom,
    })))
    expect(rows[1].top - rows[0].bottom).toBeLessThanOrEqual(1)
    expect(rows.every((row) => row.paddingTop === "0px" && row.paddingBottom === "0px")).toBe(true)
    const copyBounds = await assistant.getByRole("button", { name: "Copy message", exact: true }).boundingBox()
    const durationBounds = await duration.boundingBox()
    expect(copyBounds).not.toBeNull()
    expect(durationBounds).not.toBeNull()
    if (copyBounds && durationBounds) {
      expect(durationBounds.x).toBeGreaterThan(copyBounds.x + copyBounds.width)
      expect(Math.abs(durationBounds.y + durationBounds.height / 2 - copyBounds.y - copyBounds.height / 2)).toBeLessThan(1)
    }
    for (const message of messages) {
      const row = page.locator(`[data-message-role="${message.role}"]`)
      await row.hover()
      await row.getByRole("button", { name: "Copy message", exact: true }).click()
      await expect(row.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(message.content)
    }
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard)
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
