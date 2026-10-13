import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-context-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const calculus = newTopic("Calculus")
  const automata = newTopic("Automata")
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.topics.push(calculus, automata)
    state.chats.push(newChat(state.runners[0].id, "Existing chat"))
  })
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...environment
  } = process.env
  const { PRUNE_PACKAGED_APP: executablePath } = z.object({
    PRUNE_PACKAGED_APP: z.string().optional(),
  }).parse(process.env)
  const launch = () => _electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  return { directory, launch, calculus, automata }
}

test("chat sends include the currently open topic as context without changing the typed message", async () => {
  const { directory, launch, calculus, automata } = await fixture()
  const app = await launch()
  try {
    const page = await app.firstWindow()
    const navigation = page.getByRole("navigation", { name: "Your topics" })
    for (const topic of [automata, calculus]) {
      await navigation.getByRole("button", { name: topic.title, exact: true }).click()
      await page.getByRole("textbox", { name: "Message this chat" }).fill("What is next?")
      await page.getByRole("form", { name: "Chat composer" }).getByRole("button", { name: "Send message" }).click()
      await expect.poll(async () => {
        const snapshot = await page.evaluate(() => window.prune?.snapshot())
        return snapshot?.chats[0].messages.filter((message) => message.role === "assistant").length
      }).toBe(topic.id === automata.id ? 1 : 2)
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      const message = snapshot?.chats[0].messages.filter((message) => message.role === "user").at(-1)
      expect(message?.content).toBe("What is next?")
      expect(message?.topicIds).toEqual([topic.id])
    }
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("a chat with attached files can send without typed text", async () => {
  const { directory, launch } = await fixture()
  const source = join(directory, "notes.txt")
  await writeFile(source, "Notes about limits")
  const app = await launch()
  try {
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    const page = await app.firstWindow()
    const composer = page.getByRole("form", { name: "Chat composer" })
    await composer.getByRole("button", { name: "Attach files to this chat" }).click()
    await expect(composer.getByText("notes.txt", { exact: true })).toBeVisible()
    const send = composer.getByRole("button", { name: "Send message" })
    await expect(send).toBeEnabled({ timeout: 3000 })
    await send.click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await composer.getByRole("button", { name: "Attach files to this chat" }).click()
    await expect(composer.getByText("notes.txt", { exact: true })).toBeVisible()
    await expect(send).toBeEnabled()
    await send.click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    expect((await page.evaluate(() => window.prune?.snapshot()))?.chats).toHaveLength(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("reopening restores the most recently viewed topic independently of chat selection", async () => {
  const { directory, launch } = await fixture()
  let app = await launch()
  try {
    let page = await app.firstWindow()
    let navigation = page.getByRole("navigation", { name: "Your topics" })
    await navigation.getByRole("button", { name: "Automata", exact: true }).click()
    await navigation.getByRole("button", { name: "Calculus", exact: true }).click()
    await page.keyboard.press("Control+Tab")
    await expect(navigation.getByRole("button", { name: "Automata", exact: true })).toHaveAttribute("aria-current", "page")
    await page.keyboard.press("Control+Tab")
    await expect(navigation.getByRole("button", { name: "Calculus", exact: true })).toHaveAttribute("aria-current", "page")
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    navigation = page.getByRole("navigation", { name: "Your topics" })
    await expect(navigation.getByRole("button", { name: "Calculus", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 3000 })
    await navigation.getByRole("button", { name: "Automata", exact: true }).click()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    navigation = page.getByRole("navigation", { name: "Your topics" })
    await expect(navigation.getByRole("button", { name: "Automata", exact: true })).toHaveAttribute("aria-current", "page")
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    await expect(page.getByRole("textbox", { name: "Message your tutor" })).toBeVisible()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    navigation = page.getByRole("navigation", { name: "Your topics" })
    await expect(navigation.getByRole("button", { name: "Automata", exact: true })).toHaveAttribute("aria-current", "page")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
