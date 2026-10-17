import { randomUUID } from "node:crypto"
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

test("topic context menus tag drafts and persist archive and unarchive actions", async () => {
  const { directory, launch } = await fixture()
  let app = await launch()
  try {
    let page = await app.firstWindow()
    let topics = page.getByRole("navigation", { name: "Your topics" })
    await topics.getByRole("button", { name: "Calculus", exact: true }).click()
    const input = page.getByRole("textbox", { name: "Message this chat" })
    await input.fill("Explain this")
    await topics.getByRole("button", { name: "Automata", exact: true }).click({ button: "right" })
    await page.getByRole("menuitem", { name: "@Tag in chat", exact: true }).click()
    await expect(input).toContainText("Explain this @Automata")
    await expect(input).toBeFocused()
    await topics.getByRole("button", { name: "Automata", exact: true }).focus()
    await page.keyboard.press("Shift+F10")
    await page.getByRole("menuitem", { name: "@Tag in chat", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expect(input).toContainText("Explain this @Automata @Automata")
    await expect(input).toBeFocused()
    await topics.getByRole("button", { name: "Automata", exact: true }).click({ button: "right" })
    await page.getByRole("menuitem", { name: "Archive Chat", exact: true }).click()
    await expect(topics.getByRole("button", { name: "Automata", exact: true })).toHaveCount(0)
    await expect(page.getByRole("navigation", { name: "Archived chats" }).getByRole("button", { name: "Automata", exact: true })).toBeVisible()
    await input.fill("@")
    const suggestions = page.getByRole("listbox", { name: "Topics", exact: true }).getByRole("option")
    await expect(suggestions).toHaveText(["Calculus", "Automata"])
    await input.fill("@Auto")
    await expect(suggestions).toHaveText(["Automata"])
    await suggestions.first().click()
    await expect(input).toContainText("@Automata")
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    const archived = page.getByRole("navigation", { name: "Archived chats" })
    await archived.getByRole("button", { name: "Automata", exact: true }).click({ button: "right" })
    await page.getByRole("menuitem", { name: "Unarchive Chat", exact: true }).click()
    topics = page.getByRole("navigation", { name: "Your topics" })
    await expect(topics.getByRole("button", { name: "Automata", exact: true })).toBeVisible()
    await expect(archived).toHaveCount(0)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByRole("navigation", { name: "Your topics" }).getByRole("button", { name: "Automata", exact: true })).toBeVisible()
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("chat assets stay available without composer chips even when their IDs differ from topic assets", async () => {
  const { directory, launch, calculus } = await fixture()
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  await repository.mutate((state) => {
    const material = { id: calculus.id, name: "Lecture 4.pdf", kind: "pdf" as const, text: "Limits", pages: ["Limits"] }
    state.topics[0].materials.push(material)
    state.chats[0].materials.push({ ...material, id: randomUUID() })
  })
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole("navigation", { name: "Your topics" }).getByRole("button", { name: "Calculus", exact: true }).click()
    const composer = page.getByRole("form", { name: "Chat composer" })
    await expect(composer.getByText("Lecture 4.pdf", { exact: true })).toHaveCount(0)
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics[0].materials[0].name).toBe("Lecture 4.pdf")
    expect(snapshot?.chats[0].materials[0].name).toBe("Lecture 4.pdf")
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
    await expect(composer.getByText("notes.txt", { exact: true })).toHaveCount(0)
    const send = composer.getByRole("button", { name: "Send message" })
    await expect(send).toBeEnabled({ timeout: 3000 })
    await send.click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await composer.getByRole("button", { name: "Attach files to this chat" }).click()
    await expect(composer.getByText("notes.txt", { exact: true })).toHaveCount(0)
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

test("structured curriculum confirmation records the asking thread and keeps questions out of the summary", async () => {
  const { directory, launch, calculus } = await fixture()
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole("navigation", { name: "Your topics" }).getByRole("button", { name: "Calculus", exact: true }).click()
    const composer = page.getByRole("form", { name: "Chat composer" })
    await page.getByRole("textbox", { name: "Message this chat" }).fill("Plan structured Limits curriculum.")
    await composer.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByRole("button", { name: "Confirm plan & begin" })).toBeVisible()
    await page.getByRole("button", { name: "Confirm plan & begin" }).click()
    await expect(page.getByText("Why can a limit exist where the function is undefined?", { exact: true })).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    const topic = snapshot?.topics.find((topic) => topic.id === calculus.id)
    const threadId = snapshot?.chats[0].id
    expect(topic?.state?.threadTutors).toEqual([{ id: threadId, progress: { "tp-structured-limits": { status: "active", steps: [{ question: "Why can a limit exist where the function is undefined?" }] } } }])
    expect(topic?.learning.notes).toContain("A function's limit describes its nearby behavior")
    expect(topic?.learning.notes).not.toContain("Distinguish a limit from a function value")
    await expect(page.getByRole("navigation", { name: "Topic directory", exact: true })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Topic directory", exact: true }).getByRole("button", { name: "Limits", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Topic terminology", exact: true })).toBeVisible()
    expect(topic?.learning.notes).not.toContain("Why can a limit exist")
    const reloaded = new WorkspaceRepository(join(directory, "workspace"))
    await reloaded.load()
    expect(reloaded.topic(calculus.id).state?.threadTutors).toEqual(topic?.state?.threadTutors)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("chat renders partial reply snapshots and replaces them with one completed message", async () => {
  const { directory, launch } = await fixture()
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("textbox", { name: "Message this chat" })).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune!.snapshot())
    const chat = snapshot.chats[0]
    chat.messages.push({ id: chat.id, role: "user", content: "Explain limits", createdAt: new Date().toISOString(), topicIds: [] })
    snapshot.runtime = [{ runnerId: chat.runnerId, chatId: chat.id, status: "running", activity: "Preparing your lesson", reply: "A limit describes" }]
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("prune:update", value), snapshot)
    await expect(page.getByText("A limit describes", { exact: true })).toBeVisible()
    snapshot.runtime[0].reply = "A limit describes nearby behavior."
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("prune:update", value), snapshot)
    await expect(page.getByText("A limit describes nearby behavior.", { exact: true })).toBeVisible()
    chat.messages.push({ id: randomUUID(), role: "assistant", content: "A limit describes nearby behavior.", createdAt: new Date().toISOString(), topicIds: [] })
    snapshot.runtime = [{ runnerId: chat.runnerId, chatId: chat.id, status: "ready", activity: "Ready" }]
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("prune:update", value), snapshot)
    await expect(page.getByText("A limit describes nearby behavior.", { exact: true })).toHaveCount(1)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
