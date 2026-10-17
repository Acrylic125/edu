import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("response choices submit once, preserve typed drafts, and stay inactive in history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-question-responses-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.load()
  const runnerId = repository.stateSnapshot.runners[0].id
  const chat = { ...newChat(runnerId, "Question responses"), titleGenerated: true }
  await repository.mutate((state) => {
    state.runners = [{ id: runnerId, name: "Tutor", provider: "claude", model: "default" }]
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push({ ...chat, messages: [{
      id: randomUUID(), role: "assistant", createdAt: new Date().toISOString(), topicIds: [],
      content: "Your summary explains the distinction.",
      responseQuestion: { prompt: "What would you like to do next?", options: ["Continue", "Quick practice"] },
    }] })
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "All chats", exact: true }).click()
    await page.getByRole("dialog", { name: "All chats" }).getByRole("button", { name: chat.title, exact: true }).click()
    const question = page.getByRole("group", { name: "What would you like to do next?" })
    await expect(question).toBeVisible()
    await page.locator('[data-message-role="assistant"]').getByRole("button", { name: "Copy message", exact: true }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "Your summary explains the distinction.\n\nWhat would you like to do next?\n- Continue\n- Quick practice",
    )
    const composer = page.getByRole("textbox", { name: "Message this chat" })
    await composer.fill("A question I am still drafting")
    await question.getByRole("button", { name: "Quick practice", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(page.locator('[data-message-role="user"]')).toHaveText("Quick practice")
    await expect(question.getByRole("button", { name: "Continue", exact: true })).toBeDisabled()
    await expect(composer).toHaveText("A question I am still drafting")
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      return snapshot?.chats.find((item) => item.id === chat.id)?.messages.filter((message) => message.role === "user").map((message) => message.content)
    }).toEqual(["Quick practice"])
    await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(2)
    await expect(question.getByRole("button", { name: "Quick practice", exact: true })).toBeDisabled()
    await page.reload()
    await expect(question.getByRole("button", { name: "Continue", exact: true })).toBeDisabled()
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard)
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
