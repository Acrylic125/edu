import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("chats sharing a model can run and stop independently through the composer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-concurrent-chats-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.load()
  const runnerId = repository.stateSnapshot.runners[0].id
  const first = { ...newChat(runnerId, "Chat A"), titleGenerated: true }
  const second = { ...newChat(runnerId, "Chat B"), titleGenerated: true }
  await repository.mutate((state) => {
    state.runners = [{ id: runnerId, name: "Tutor", provider: "claude", model: "default" }]
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push(first, second)
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    const composer = page.getByRole("form", { name: "Chat composer", exact: true })
    const openChat = async (name: string) => {
      await page.getByRole("button", { name: "All chats", exact: true }).click()
      await page.getByRole("dialog", { name: "All chats" }).getByRole("button", { name, exact: true }).click()
      await expect(page.getByRole("tab", { selected: true })).toHaveText(name)
    }
    await openChat("Chat A")
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Hold concurrent turn A")
    await composer.getByRole("button", { name: "Send message", exact: true }).click()
    await expect(composer.getByRole("button", { name: "Stop runner" })).toBeVisible()
    await openChat("Chat B")
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Hold concurrent turn B")
    await expect(composer.getByRole("button", { name: "Send message", exact: true })).toBeEnabled()
    await composer.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      return snapshot?.runtime.filter((runtime) => runtime.status === "running").length
    }).toBe(2)
    await composer.getByRole("button", { name: "Stop runner" }).click()
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      return snapshot?.runtime.filter((runtime) => runtime.status === "running").map((runtime) => runtime.chatId)
    }).toEqual([first.id])
    await openChat("Chat A")
    await expect(composer.getByRole("button", { name: "Stop runner" })).toBeVisible()
    await composer.getByRole("button", { name: "Stop runner" }).click()
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      return snapshot?.runtime.some((runtime) => runtime.status === "running")
    }).toBe(false)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
