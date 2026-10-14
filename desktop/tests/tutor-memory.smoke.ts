import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("tutor preferences survive a native app restart and are loaded into a new chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-tutor-memory-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push(newChat(state.runners[0].id, "Tutoring preferences"))
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const launch = () => _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    let composer = page.getByRole("form", { name: "Chat composer" })
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Remember to explain in small steps across all my lessons.")
    await composer.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByText("I’ll explain in small steps.", { exact: true })).toBeVisible()
    const preferences = await readFile(join(directory, "workspace", "tutor-memory", "behaviour.md"), "utf8")
    expect(preferences).toContain("Explain in small steps.")
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    composer = page.getByRole("form", { name: "Chat composer" })
    await page.getByRole("textbox", { name: "Message this chat" }).fill("What tutor preference is saved?")
    await composer.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByText("Explain in small steps.", { exact: true })).toBeVisible()
    const restored = await new WorkspaceRepository(join(directory, "workspace")).load()
    expect(restored.behaviourMemory).toBe(preferences)
    expect(restored.chats).toHaveLength(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
