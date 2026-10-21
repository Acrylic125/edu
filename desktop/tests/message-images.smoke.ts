import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("sent images stay on their user message, open in the viewer and survive reload", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-message-images-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const chat = newChat(repository.stateSnapshot.runners[0].id)
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.chats.push(chat)
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, image) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] })
    }, resolve("src/renderer/assets/app-icon.png"))
    const composer = page.getByRole("form", { name: "Chat composer", exact: true })
    await composer.getByRole("button", { name: "Attach files to this chat" }).click()
    const input = page.getByRole("textbox", { name: "Message this chat" })
    await input.fill("Explain this image")
    await composer.getByRole("button", { name: "Send message", exact: true }).click()
    const messages = page.locator('[data-message-role="user"]')
    const image = messages.first().getByRole("img", { name: "app-icon.png", exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("sent-image-message.png") })
    await image.click()
    const viewer = page.getByRole("dialog", { name: "app-icon.png", exact: true })
    await expect(viewer).toBeVisible()
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click()
    await expect(viewer.getByRole("button", { name: "Reset zoom" })).toHaveText("150%")
    await viewer.getByRole("button", { name: "Close preview" }).click()
    await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.runtime.find((runtime) => runtime.chatId === chat.id)?.status).not.toBe("running")
    await input.fill("Ask a follow-up without another image")
    await composer.getByRole("button", { name: "Send message", exact: true }).click()
    await expect(messages).toHaveCount(2)
    await expect(messages.nth(1).getByRole("img")).toHaveCount(0)
    await page.reload()
    await expect(image).toBeVisible()
    await expect(messages.nth(1).getByRole("img")).toHaveCount(0)
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    const topicComposer = page.getByRole("form", { name: "New scratchpad composer", exact: true })
    await topicComposer.getByRole("button", { name: "Add learning materials" }).click()
    await page.getByRole("textbox", { name: "Message your tutor" }).fill("Learn from this image")
    await topicComposer.getByRole("button", { name: "Send message", exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.topics.length).toBe(1)
    await expect(messages).toHaveCount(1)
    await expect(image).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    const topicImage = snapshot?.topics[0].materials.find((material) => material.kind === "image")
    expect(topicImage).toBeDefined()
    expect(snapshot?.chats[0].messages[0].materialIds).toEqual([topicImage!.id])
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
