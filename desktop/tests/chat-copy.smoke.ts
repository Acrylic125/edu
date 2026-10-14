import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
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
    { role: "assistant" as const, content: "**Finite automata**\n\n1. Start at q₀.\n2. Read each symbol." },
  ]
  await repository.load()
  await repository.mutate((state) => {
    state.runners.push({ id: runnerId, name: "Tutor", provider: "openrouter", model: "default" })
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
