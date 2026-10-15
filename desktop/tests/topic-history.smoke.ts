import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

test("cross-topic mistake history is retrieved in a new chat after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-history-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push(newChat(state.runners[0].id, "Past mistakes"))
    const first = newTopic("Calculus")
    first.learning.notes = "# Calculus\n\nPast mistake: confused approaching a limit with reaching it."
    const second = newTopic("Physics")
    second.archived = true
    second.learning.notes = "# Physics\n\nPast mistake: confused speed with acceleration. Now resolved."
    second.learning.privateAnswerKey = "PRIVATE_PHYSICS_KEY"
    state.topics.push(first, second)
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const launch = () => _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    let composer = page.getByRole("form", { name: "Chat composer" })
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Across all topics, what are the past mistakes I have made?")
    await composer.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByText(/Past mistake: confused approaching a limit/)).toBeVisible()
    await expect(page.getByText(/Past mistake: confused speed with acceleration/)).toBeVisible()
    await expect(page.getByText("PRIVATE_PHYSICS_KEY", { exact: true })).toHaveCount(0)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    composer = page.getByRole("form", { name: "Chat composer" })
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Across all topics, what are the past mistakes I have made?")
    await composer.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByText(/Past mistake: confused approaching a limit/)).toBeVisible()
    await expect(page.getByText(/Past mistake: confused speed with acceleration/)).toBeVisible()
    const restored = await new WorkspaceRepository(join(directory, "workspace")).load()
    expect(restored.topics).toHaveLength(2)
    expect(restored.chats).toHaveLength(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
