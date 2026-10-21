import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("conversation preserves each chat's scroll position across switching and restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-chat-scroll-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.load()
  await repository.mutate((state) => {
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    for (const title of ["Scroll A", "Scroll B"]) {
      const chat = newChat(state.runners[0].id, title)
      chat.messages = Array.from({ length: 40 }, (_, index) => ({
        id: randomUUID(), role: "assistant", content: `Message ${index}\n\n${"Some learning content. ".repeat(30)}`,
        topicIds: [], createdAt: new Date().toISOString(),
      }))
      state.chats.push(chat)
    }
  })
  const { ELECTRON_RENDERER_URL: _url, ELECTRON_RUN_AS_NODE: _node, ...environment } = process.env
  const launch = () => _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const scroll = () => page.getByRole("log", { name: "Conversation" })
    const select = async (name: string) => {
      await page.getByRole("tab", { name, exact: true }).click()
      await expect(page.getByRole("tab", { selected: true })).toHaveText(name)
    }
    const move = async (top: number) => {
      await scroll().evaluate((element, value) => { element.scrollTop = value }, top)
      await expect.poll(() => scroll().evaluate((element) => element.scrollTop)).toBe(top)
      // Allow the browser to dispatch the native scroll event before changing views.
      await page.waitForTimeout(100)
    }
    await select("Scroll A")
    await expect.poll(() => scroll().evaluate((element) =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
    )).toBeLessThanOrEqual(2)
    await move(420)
    await select("Scroll B")
    await move(850)
    await select("Scroll A")
    await expect.poll(() => scroll().evaluate((element) => element.scrollTop)).toBe(420)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect.poll(() => scroll().evaluate((element) => element.scrollTop)).toBe(420)
    await select("Scroll B")
    await expect.poll(() => scroll().evaluate((element) => element.scrollTop)).toBe(850)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
