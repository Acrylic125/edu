import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { GenericStateSchema, TestStateSchema } from "../src/shared/scratchpad-state"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

test("presets tag the recent topic and commands highlight only at the start while remaining editable", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-commands-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const topic = newTopic("Limits")
  const assessment = newTopic("Limits practice")
  assessment.state = TestStateSchema.parse({ type: "test", version: "19-10-2026", name: assessment.title, createdAt: assessment.createdAt, goals: [], questions: [], content: [], references: [] })
  const notes = newTopic("Free notes")
  notes.state = GenericStateSchema.parse({ type: "generic", version: "19-10-2026", name: notes.title, createdAt: notes.createdAt, references: [] })
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.topics.push(topic, assessment, notes)
    const chat = newChat(state.runners[0].id)
    chat.messages.push({ id: randomUUID(), role: "user", content: "Teach me limits", createdAt: new Date().toISOString(), topicIds: [topic.id] })
    state.chats.push(chat)
  })
  const { ELECTRON_RENDERER_URL: _url, ELECTRON_RUN_AS_NODE: _node, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: "reduce" })
    const input = page.getByRole("textbox", { name: "Message your tutor", exact: true })
    await expect(input).toBeVisible()
    for (const [scratchpad, label, color] of [
      [topic, "Topic", "rgb(246, 231, 175)"],
      [assessment, "Test", "rgb(220, 233, 223)"],
      [notes, "Generic", "rgb(223, 233, 239)"],
    ] as const) {
      const item = page.getByRole("navigation", { name: "Your scratchpads" }).getByRole("button", { name: scratchpad.title, exact: true })
      await item.click()
      await expect(item).toHaveAttribute("aria-current", "page")
      await expect(item).toHaveCSS("background-color", color)
      const badge = page.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${label}$`) })
      await expect(badge).toBeVisible()
      await expect(badge).toHaveCSS("background-color", color)
    }
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await input.fill("/")
    const commands = page.getByRole("listbox", { name: "Scratchpad commands" })
    await expect(commands.getByRole("option")).toHaveCount(3)
    const menuBox = await commands.boundingBox()
    const composerBox = await input.boundingBox()
    if (!menuBox || !composerBox) throw new Error("Missing command menu or composer")
    expect(menuBox.y + menuBox.height).toBeLessThan(composerBox.y)
    await page.screenshot({ path: testInfo.outputPath("command-suggestions.png") })
    await input.press("ArrowDown")
    await input.press("Enter")
    await expect(input).toHaveText("/new-test ")
    await expect(commands).toHaveCount(0)
    await expect(input.locator('[data-scratchpad-command="/new-test"]')).toBeVisible()
    await input.fill("/new-g")
    await expect(commands.getByRole("option")).toHaveCount(1)
    await commands.getByRole("option").click()
    await expect(input).toHaveText("/new-generic ")
    await input.fill("Please /new")
    await expect(commands).toHaveCount(0)
    await input.fill(" /new")
    await expect(commands).toHaveCount(0)
    const chatInput = page.getByRole("textbox", { name: "Message this chat", exact: true })
    await chatInput.fill("/new-t")
    await expect(commands.getByRole("option")).toHaveCount(2)
    await chatInput.press("Escape")
    await expect(commands).toHaveCount(0)
    await chatInput.fill("")
    await page.getByRole("button", { name: "Test Me on @Limits" }).click()
    await expect(input).toHaveText("/new-test Test me on @Limits")
    await expect(input.locator('[data-scratchpad-command="/new-test"]')).toBeVisible()
    await expect(input.locator('span[title="@Limits"]')).toBeVisible()
    await page.getByRole("button", { name: "What is a State Machine?" }).click()
    await expect(input).toHaveText("/new-generic What is a state machine?")
    await expect(input.locator('[data-scratchpad-command="/new-generic"]')).toBeVisible()
    await page.getByRole("button", { name: "Learn calculus" }).click()
    await expect(input.locator('[data-scratchpad-command="/new-topic"]')).toBeVisible()
    for (const command of ["/new-topic", "/new-test", "/new-generic"]) {
      await input.fill(`${command} Explain limits`)
      await expect(input.locator("[data-scratchpad-command]")).toHaveCount(1)
      await input.press("Home")
      await input.press("Meta+ArrowLeft")
      await input.pressSequentially("x ")
      await expect(input.locator("[data-scratchpad-command]")).toHaveCount(0)
      await input.fill(`Please ${command} Explain limits`)
      await expect(input.locator("[data-scratchpad-command]")).toHaveCount(0)
      await input.fill(` ${command} Explain limits`)
      await expect(input.locator("[data-scratchpad-command]")).toHaveCount(0)
      await input.fill(`${command}suffix`)
      await expect(input.locator("[data-scratchpad-command]")).toHaveCount(0)
    }
    await input.fill("")
    await input.pressSequentially("/new-test Explain limits")
    await expect(input).toHaveText("/new-test Explain limits")
    await expect(input.locator("[data-scratchpad-command]")).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath("scratchpad-commands.png") })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("test preset falls back to an ellipsis without a topic thread", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-commands-empty-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.chats.push(newChat(state.runners[0].id))
  })
  const { ELECTRON_RENDERER_URL: _url, ELECTRON_RUN_AS_NODE: _node, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "Test Me on ..." }).click()
    await expect(page.getByRole("textbox", { name: "Message your tutor", exact: true })).toHaveText("/new-test Test me on ...")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
