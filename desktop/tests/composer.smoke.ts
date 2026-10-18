import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("topic and chat composers keep runners internal when multiple runners are saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-composer-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  await repository.mutate((state) => {
    state.runners.push({
      id: randomUUID(),
      name: "Another tutor",
      provider: "codex",
      model: "gpt-6-luna",
    })
    state.chats.push(newChat(state.runners[0].id, "Existing chat"))
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
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("textbox", { name: "Message your tutor" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Message this chat" })).toBeVisible()
    expect((await page.evaluate(() => window.prune?.snapshot()))?.runners.length).toBeGreaterThan(1)
    await expect(page.getByRole("combobox", { name: "Runner", exact: true })).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Choose provider and model" })).toHaveCount(2)

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("prune:send")
      ipcMain.handle("prune:send", () => new Promise<void>((resolve) => {
        ipcMain.once("finish-test-send", () => resolve())
      }))
    })
    const pendingChatInput = page.getByRole("textbox", { name: "Message this chat" })
    await pendingChatInput.fill("Explain limits")
    await page.getByRole("form", { name: "Chat composer", exact: true }).getByRole("button", { name: "Send message" }).click()
    await expect(page.getByRole("button", { name: "Sending message" })).toHaveAttribute("aria-busy", "true")
    await expect(pendingChatInput).toBeEditable()
    await pendingChatInput.fill("My next question")
    await app.evaluate(({ ipcMain }) => { ipcMain.emit("finish-test-send") })
    await expect(page.getByRole("button", { name: "Sending message" })).toHaveCount(0)
    await expect(pendingChatInput).toHaveText("My next question")

    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await expect(page.getByRole("tab", { name: "New chat", selected: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Runner", exact: true })).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Choose provider and model" })).toHaveCount(2)

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("prune:create-topic")
      ipcMain.handle("prune:create-topic", () => new Promise(() => {}))
    })
    await page.getByRole("textbox", { name: "Message your tutor" }).fill("Teach me limits")
    await page.getByRole("form", { name: "New topic composer" }).getByRole("button", { name: "Send message" }).click()
    await expect(page.getByRole("button", { name: "Creating topic" })).toHaveAttribute("aria-busy", "true")
    await expect(page.getByRole("button", { name: "Creating topic" }).locator("svg.animate-spin")).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "Creating your topic" })).toBeVisible()
    const chatInput = page.getByRole("textbox", { name: "Message this chat" })
    await expect(chatInput).toBeEditable()
    await chatInput.fill("My next question")
    await expect(chatInput).toHaveText("My next question")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
