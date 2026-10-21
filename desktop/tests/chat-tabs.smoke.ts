import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

test("chat tabs virtualize, close, reopen, cycle recent views, and restore after restart", async () => {
  test.setTimeout(120_000)
  const directory = await mkdtemp(join(tmpdir(), "edu-chat-tabs-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const runnerId = randomUUID()
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.runners.push({
      id: runnerId,
      name: "Tutor",
      provider: "claude",
      model: "default",
    })
    state.chats.push(
      ...Array.from({ length: 200 }, (_, index) => ({
        ...newChat(runnerId, `Chat ${String(index).padStart(3, "0")}`),
        createdAt: new Date(Date.UTC(2026, 9, 13) - index * 1000).toISOString(),
      })),
    )
  })
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...environment
  } = process.env
  const launch = () =>
    _electron.launch({
      args: [resolve(".")],
      env: { ...environment, PRUNE_DATA_DIR: directory },
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const selected = () => page.getByRole("tab", { selected: true })
    const openChat = async (name: string) => {
      await page.getByRole("button", { name: "All chats", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "All chats" })
      await expect(
        dialog.getByRole("button", { name: "Chat 000", exact: true }),
      ).toBeVisible()
      await dialog.getByRole("textbox", { name: "Search chats" }).fill(name)
      await dialog.getByRole("button", { name, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(selected()).toHaveText(name)
      await expect
        .poll(async () => {
          return page.evaluate(
            () =>
              document.activeElement?.closest("[data-chat-context]") != null,
          )
        })
        .toBe(true)
    }
    await expect(selected()).toHaveText("Chat 000")
    expect(await page.getByRole("tab").count()).toBeLessThan(10)
    const first = selected()
    const closeFirst = page.getByRole("button", {
      name: "Close Chat 000",
      exact: true,
    })
    await page.getByRole("button", { name: "All chats", exact: true }).hover()
    await expect(closeFirst).toHaveCSS("opacity", "0")
    await first.hover()
    await expect(closeFirst).toHaveCSS("opacity", "1")
    await page.getByRole("button", { name: "All chats", exact: true }).hover()
    await first.focus()
    await expect(closeFirst).toHaveCSS("opacity", "1")
    await page.keyboard.press("End")
    await expect(selected()).toHaveText("Chat 199")
    await expect(selected()).toBeFocused()
    await page.keyboard.press("Home")
    await expect(selected()).toHaveText("Chat 000")
    await expect(selected()).toBeFocused()

    await openChat("Chat 050")
    await openChat("Chat 199")
    await page
      .getByRole("textbox", { name: "Message this chat" })
      .fill("Draft for 199")
    await page.keyboard.down("Control")
    await page.keyboard.press("Tab")
    await expect(selected()).toHaveText("Chat 050")
    await page.keyboard.press("Tab")
    await expect(selected()).toHaveText("Chat 000")
    await page.keyboard.press("Shift+Tab")
    await expect(selected()).toHaveText("Chat 050")
    await page.keyboard.up("Control")
    await page.keyboard.press("Control+Tab")
    await expect(selected()).toHaveText("Chat 199")
    await expect(
      page.getByRole("textbox", { name: "Message this chat" }),
    ).toHaveText("Draft for 199")
    await page.keyboard.press("Control+Tab")
    await expect(selected()).toHaveText("Chat 050")
    await page.keyboard.press("Control+Shift+Tab")
    await expect(selected()).toHaveText("Chat 198")

    await openChat("Chat 199")
    await page
      .getByRole("button", { name: "Close Chat 199", exact: true })
      .click()
    await expect(selected()).toHaveText("Chat 198")
    await expect(
      page.getByRole("tab", { name: "Chat 199", exact: true }),
    ).toHaveCount(0)
    await openChat("Chat 199")
    await expect(
      page.getByRole("textbox", { name: "Message this chat" }),
    ).toHaveText("Draft for 199")
    await page
      .getByRole("button", { name: "Close Chat 199", exact: true })
      .click()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(selected()).toHaveText("Chat 198")
    await expect(
      page.getByRole("tab", { name: "Chat 199", exact: true }),
    ).toHaveCount(0)
    await openChat("Chat 199")
    expect(await page.getByRole("tab").count()).toBeLessThan(10)
    const savedTabs = await page.evaluate(() => localStorage.getItem("edu:chat-tabs"))
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await expect(selected()).toHaveText("Chat 199")
    expect(await page.evaluate(() => localStorage.getItem("edu:chat-tabs"))).toBe(savedTabs)
    await expect(page.getByRole("tab", { name: "New scratchpad", exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "All chats", exact: true }),
    ).toBeVisible()
    await page
      .getByRole("textbox", { name: "Message your tutor" })
      .fill("Plan my next topic")
    await openChat("Chat 199")
    await page.keyboard.press("Control+Tab")
    await expect(selected()).toHaveText("Chat 198")
    await expect(
      page.getByRole("textbox", { name: "Message your tutor" }),
    ).toHaveText("Plan my next topic")
    await page.getByRole("button", { name: "All chats", exact: true }).click()
    const library = page.getByRole("dialog", { name: "All chats" })
    await library
      .getByRole("textbox", { name: "Search chats" })
      .fill("New scratchpad")
    await expect(library.getByRole("button", { name: "New scratchpad", exact: true })).toHaveCount(0)
    await expect(library.getByText("No chats match your search.")).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await expect(
      page.getByRole("textbox", { name: "Message your tutor" }),
    ).toHaveText("Plan my next topic")
    await page.screenshot({ path: "test-results/chat-tabs.png" })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("submitting a new topic opens a conversation only after creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-new-topic-tab-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const runnerId = randomUUID()
  await repository.load()
  await repository.mutate((state) => {
    state.runners = [
      {
        id: runnerId,
        name: "Tutor",
        provider: "claude",
        model: "default",
      },
    ]
    state.providerSettings.push({
      id: "claude",
      displayName: "Fixture tutor",
      binaryPath: executable,
      enabled: true,
    })
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
    await expect(page.getByRole("tab")).toHaveCount(0)
    expect(
      (await page.evaluate(() => window.prune?.snapshot()))?.chats,
    ).toHaveLength(0)
    await page
      .getByRole("textbox", { name: "Message your tutor" })
      .fill("Teach me limits")
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click()
    await expect(
      page.getByRole("heading", {
        name: "Introduction to Limits",
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "New scratchpad", exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText("Here is your learning plan. Confirm it to begin.", {
        exact: true,
      }),
    ).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.chats).toHaveLength(1)
    await expect(page.getByRole("tab", { selected: true })).toHaveText(
      snapshot?.chats[0].title ?? "",
    )
    await page.getByRole("button", { name: "All chats", exact: true }).click()
    await expect(
      page
        .getByRole("dialog", { name: "All chats" })
        .getByRole("button", { name: "New scratchpad", exact: true }),
    ).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("Ctrl+Tab chooses chats or topics from the focused context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-context-tabs-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    const runnerId = state.runners[0].id
    state.chats.push(newChat(runnerId, "Chat A"), newChat(runnerId, "Chat B"))
    state.topics.push(
      ...["Topic A", "Topic B", "Topic C"].map((title, index) => {
        const topic = newTopic(title)
        topic.createdAt = new Date(Date.UTC(2026, 9, 13) - index * 1000).toISOString()
        if (topic.state) topic.state.createdAt = topic.createdAt
        return topic
      }),
    )
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
    const selectedChat = page.getByRole("tab", {
      selected: true,
      includeHidden: true,
    })
    const navigation = page.getByRole("navigation", { name: "Your scratchpads" })
    await navigation
      .getByRole("button", { name: "Topic A", exact: true })
      .click()
    await page.getByRole("tab", { name: "Chat A", exact: true }).click()
    await page.getByRole("tab", { name: "Chat B", exact: true }).click()
    await page.keyboard.press("Control+Tab")
    await expect(selectedChat).toHaveText("Chat A")
    await expect(
      page.getByRole("heading", { name: "Topic A", exact: true }),
    ).toBeVisible()

    await navigation
      .getByRole("button", { name: "Topic A", exact: true })
      .focus()
    await page.keyboard.press("Control+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic B", exact: true }),
    ).toBeVisible()
    await expect(selectedChat).toHaveText("Chat A")
    await page.keyboard.press("Control+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic C", exact: true }),
    ).toBeVisible()
    await page.keyboard.press("Control+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic A", exact: true }),
    ).toBeVisible()
    await page.keyboard.press("Control+Shift+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic C", exact: true }),
    ).toBeVisible()
    await page.getByRole("heading", { name: "Topic C", exact: true }).click()
    await page.keyboard.press("Control+Shift+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic B", exact: true }),
    ).toBeVisible()
    await expect(selectedChat).toHaveText("Chat A")

    await page
      .getByRole("textbox", { name: "Message this chat" })
      .fill("Keep this draft")
    await page.keyboard.press("Control+Tab")
    await expect(selectedChat).toHaveText("Chat B")
    await page.keyboard.press("Control+Tab")
    await expect(selectedChat).toHaveText("Chat A")
    await expect(
      page.getByRole("textbox", { name: "Message this chat" }),
    ).toHaveText("Keep this draft")
    await expect(
      page.getByRole("heading", { name: "Topic B", exact: true }),
    ).toBeVisible()

    await page.getByRole("button", { name: "All chats", exact: true }).click()
    const library = page.getByRole("dialog", { name: "All chats" })
    await expect(
      library.getByRole("textbox", { name: "Search chats" }),
    ).toBeFocused()
    await page.keyboard.press("Control+Tab")
    await expect(selectedChat).toHaveText("Chat B")
    await expect(library).toBeVisible()
    await expect(
      library.getByRole("button", { name: "Chat B", exact: true }),
    ).toHaveAttribute("aria-current", "true")
    await page.keyboard.press("Control+Shift+Tab")
    await expect(selectedChat).toHaveText("Chat A")
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await expect(selectedChat).toHaveText("Chat A")
    await expect(page.getByRole("tab", { name: "New scratchpad", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "New scratchpad", exact: true }).focus()
    await page.keyboard.press("Control+Tab")
    await expect(
      page.getByRole("heading", { name: "Topic A", exact: true }),
    ).toBeVisible()
    await expect(selectedChat).toHaveText("Chat A")
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await page
      .getByRole("textbox", { name: "Message your tutor" })
      .fill("A topic draft")
    await page.keyboard.down("Control")
    await page.keyboard.press("Tab")
    await expect(page.getByRole("heading", { name: "Topic A", exact: true })).toBeVisible()
    await expect(selectedChat).toHaveText("Chat A")
    await page.keyboard.press("Shift+Tab")
    await expect(page.getByRole("heading", { name: "Topic C", exact: true })).toBeVisible()
    await expect(selectedChat).toHaveText("Chat A")
    await page.keyboard.up("Control")
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await expect(
      page.getByRole("textbox", { name: "Message your tutor" }),
    ).toHaveText("A topic draft")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
