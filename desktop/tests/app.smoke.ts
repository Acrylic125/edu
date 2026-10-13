import { chmod, mkdtemp, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"

test("native sandboxed app manages runners and restores topics across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-native-"))
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...inheritedEnvironment
  } = process.env
  const environment = { ...inheritedEnvironment, PRUNE_DATA_DIR: directory }
  const launch = () =>
    _electron.launch({
      executablePath: process.env.PRUNE_PACKAGED_APP,
      args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
      env: environment,
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(
      page.getByRole("heading", { name: /What will you.*learn today\?/ }),
    ).toBeVisible()
    await expect(page).toHaveTitle("EdU")
    await expect(page.getByRole("button", { name: "EdU", exact: true })).toBeVisible()
    const appIcon = page.getByRole("button", { name: "EdU", exact: true }).locator("img")
    await expect(appIcon).toBeVisible()
    await expect.poll(() => appIcon.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)).toBe(true)
    await expect(page.getByRole("button", { name: /^Runners/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Model accounts" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Change appearance" })).toHaveCount(0)
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("radio", { name: "Light", exact: true }).check()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.locator("html")).not.toHaveClass("dark")
    await expect(
      page.getByRole("button", { name: /Learn calculus/ }),
    ).toHaveCSS("background-color", "rgb(246, 231, 175)")
    await page.getByRole("button", { name: /Learn calculus/ }).click()
    await expect(page.getByLabel("Message your tutor")).toHaveText(
      "Help me learn calculus, starting with limits, derivatives and integrals.",
    )
    await expect(page.getByLabel("Message your tutor")).toBeFocused()
    await page.getByLabel("Message your tutor").fill("")
    await page.screenshot({ path: "test-results/welcome.png" })
    expect(await page.evaluate(() => typeof window.prune?.send)).toBe(
      "function",
    )
    expect(await page.evaluate(() => "require" in window)).toBe(false)
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    await expect(page.getByText("Choose your own provider")).toBeVisible()
    await page.getByRole("button", { name: "Add provider", exact: true }).click()
    await page.getByRole("button", { name: /ChatGPT.*Sign in/ }).click()
    await expect(page.getByRole("button", { name: "Sign in with ChatGPT" })).toBeVisible()
    await page.getByLabel("Display name", { exact: true }).fill("My ChatGPT")
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("button", { name: "My ChatGPT", exact: true })).toBeVisible()
    await page.screenshot({ path: "test-results/providers.png" })
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (await window.prune?.snapshot())?.providers.find(
                (provider) => provider.id === "codex",
              )?.models.length ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0)
    const codexModel = await page.evaluate(async () => {
      const models = (await window.prune?.snapshot())?.providers.find(
        (provider) => provider.id === "codex",
      )?.models
      const model = models?.find((model) => model.reasoningEfforts.length > 0)
      if (!model)
        throw new Error("Codex model catalog is missing reasoning options")
      return {
        id: model.id,
        name: model.name,
        effort: model.reasoningEfforts[0],
      }
    })
    await page.getByRole("button", { name: "Appearance", exact: true }).click()
    await page.getByRole("radio", { name: "Dark", exact: true }).check()
    await page.screenshot({ path: "test-results/appearance-dark.png" })
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.locator("html")).toHaveClass("dark")
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    const modelTrigger = page.getByRole("combobox", {
      name: "Choose provider and model",
    })
    await modelTrigger.click()
    await page.getByRole("button", { name: "OpenRouter", exact: true }).click()
    await page.getByRole("combobox", { name: "Search models" }).fill("openrouter/auto")
    await page.getByRole("option", { name: "Auto", exact: true }).click()
    await expect(modelTrigger).toHaveText(/Auto/)
    await expect(page.getByRole("listbox", { name: "Models" })).not.toBeVisible()
    await modelTrigger.click()
    await page.getByRole("button", { name: "My ChatGPT", exact: true }).click()
    await page
      .getByRole("combobox", { name: "Search models" })
      .fill("no-model-matches-this")
    await expect(
      page.getByText("No matching models", { exact: true }),
    ).toBeVisible()
    await page
      .getByRole("combobox", { name: "Search models" })
      .fill(codexModel.name)
    await expect(
      page.getByRole("option", { name: codexModel.name, exact: true }),
    ).toBeVisible()
    await page
      .getByRole("combobox", { name: "Search models" })
      .press("ArrowDown")
    await page.getByRole("combobox", { name: "Search models" }).press("Enter")
    await expect(modelTrigger).toHaveText(codexModel.name)
    await expect(page.getByRole("listbox", { name: "Models" })).not.toBeVisible()
    await page.getByRole("button", { name: "Choose reasoning effort" }).click()
    await page
      .getByRole("menuitemradio", {
        name: `${codexModel.effort} reasoning`,
        exact: true,
      })
      .click()
    await expect(page.getByRole("menu")).not.toBeVisible()
    await modelTrigger.click()
    const favoriteButton = page.getByRole("button", {
      name: `Favorite ${codexModel.name} from My ChatGPT`,
      exact: true,
    })
    await favoriteButton.click()
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Favorites", exact: true }).click()
    await expect(page.getByRole("option")).toHaveCount(1)
    await expect(page.getByRole("option", { name: codexModel.name, exact: true })).toBeVisible()
    await page.getByRole("button", { name: "My ChatGPT", exact: true }).click()
    await page.screenshot({ path: "test-results/model-picker.png" })
    await page
      .locator('[aria-label="Choose a model"]')
      .screenshot({ path: "test-results/model-menu.png" })
    await page.keyboard.press("Escape")
    await expect(modelTrigger).toBeFocused()
    await modelTrigger.click()
    await page
      .getByRole("heading", { name: /What will you.*learn today\?/ })
      .click()
    await expect(page.getByRole("listbox", { name: "Models" })).not.toBeVisible()
    await modelTrigger.click()
    await page.getByRole("button", { name: /More models/ }).click()
    await page
      .getByRole("option", { name: "Default model", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Choose reasoning effort" }),
    ).not.toBeVisible()
    await page.screenshot({ path: "test-results/welcome-dark.png" })
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("radio", { name: "Light", exact: true }).check()
    await expect(page.locator("html")).not.toHaveClass("dark")
    await page.screenshot({ path: "test-results/appearance-light.png" })
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await page.evaluate(async (model) => {
      const bridge = window.prune
      if (!bridge) throw new Error("Missing desktop bridge")
      const snapshot = await bridge.snapshot()
      await bridge.startRunner(snapshot.runners[0].id)
      await bridge.stopRunner(snapshot.runners[0].id)
      await bridge.addRunner({ name: "Physics tutor", provider: "codex", model: model.id, reasoningEffort: model.effort })
    }, codexModel)
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    await page.getByLabel("Message your tutor").fill("Teach me calculus")
    await page.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByRole("alert")).toContainText(
      "Connect your model account",
    )
    await expect(
      page.getByRole("heading", { name: "Teach me calculus", exact: true }),
    ).toBeVisible()
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [source],
      })
    }, resolve("tests/fixtures/limits.pdf"))
    await page.getByRole("button", { name: "Add sources to this topic" }).click()
    await expect(page.getByText("limits.pdf", { exact: true })).toBeVisible()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page
      .getByRole("button", { name: "Teach me calculus", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "Teach me calculus", exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        async () => (await window.prune?.snapshot())?.runners.length,
      ),
    ).toBe(2)
    const restored = await page.evaluate(async () =>
      (await window.prune?.snapshot())?.runners.find(
        (runner) => runner.name === "Physics tutor",
      ),
    )
    expect(restored).toMatchObject({
      provider: "codex",
      model: codexModel.id,
      reasoningEffort: codexModel.effort,
    })
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("radio", { name: "Light", exact: true }).check()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    await expect(page.getByRole("button", { name: "My ChatGPT", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    const snapshot = await page.evaluate(async () => window.prune?.snapshot())
    const topic = snapshot?.topics.find(
      (topic) => topic.title === "Teach me calculus",
    )
    const chat = snapshot?.chats[0]
    if (!snapshot || !topic || !chat) throw new Error("Missing restored topic or chat")
    await expect(page.getByRole("navigation", { name: "Your topics" }).locator("svg")).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: "Open topics", exact: true }).click()
    const navigation = page.getByRole("complementary", {
      name: "Workspace navigation",
    })
    await expect(navigation).toBeVisible()
    await navigation
      .getByRole("button", { name: topic.title, exact: true })
      .click()
    await expect(navigation).not.toBeVisible()
    await page.getByRole("button", { name: "Open chat", exact: true }).click()
    const tutorChat = page.getByRole("complementary", { name: "Tutor chat" })
    await expect(tutorChat).toBeVisible()
    await expect(tutorChat.getByLabel("Message this chat")).toBeVisible()
    await tutorChat
      .getByRole("button", { name: "Close chat", exact: true })
      .click()
    await expect(tutorChat).not.toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(tutorChat).toBeVisible()

    const topicPane = page.locator("[data-document-pane]")
    const editor = tutorChat.getByLabel("Message this chat")
    const draft = await editor.innerText()
    await page.getByRole("button", { name: "Collapse chat panel", exact: true }).click()
    await expect(tutorChat).not.toBeVisible()
    await expect(topicPane).toBeVisible()
    await page.getByRole("button", { name: "Expand chat panel", exact: true }).click()
    await expect(editor).toBeVisible()
    await expect(editor).toHaveText(draft)
    const splitWidth = (await tutorChat.boundingBox())?.width ?? 0
    await page.getByRole("button", { name: "Collapse topic panel", exact: true }).click()
    await expect(topicPane).not.toBeVisible()
    expect((await tutorChat.boundingBox())?.width).toBeGreaterThan(splitWidth)
    await page.getByRole("button", { name: "Collapse chat panel", exact: true }).click()
    await expect(topicPane).toBeVisible()
    await expect(tutorChat).not.toBeVisible()
    await page.getByRole("button", { name: "Expand chat panel", exact: true }).click()
    await page.getByRole("button", { name: "Collapse topics", exact: true }).click()
    await expect(navigation).not.toBeVisible()
    await page.getByRole("button", { name: "Expand topics", exact: true }).click()
    await expect(navigation).toBeVisible()
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    await expect(tutorChat).not.toBeVisible()
    await expect(page.getByRole("textbox")).toHaveCount(1)
    await page.getByRole("button", { name: topic.title, exact: true }).click()
    await expect(tutorChat).toBeVisible()

    await expect(
      page.getByRole("button", { name: "Export study notes" }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Open turn diagnostics" }),
    ).toHaveCount(0)
    await app.evaluate(({ shell }) => {
      shell.openPath = async (path) => {
        process.env.PRUNE_TEST_OPENED_WORKSPACE = path
        return ""
      }
    })
    await page.getByRole("button", { name: "Open workspace in Finder" }).click()
    await expect
      .poll(() => app.evaluate(() => process.env.PRUNE_TEST_OPENED_WORKSPACE))
      .toBe(join(directory, "workspace", "topics", topic.id))
    await tutorChat.getByRole("tab", { name: chat.title, exact: true }).first().click()
    await page.getByLabel("Message this chat").pressSequentially("Compare with @Teach")
    await page.screenshot({ path: "test-results/topic-mentions.png" })
    await page.getByRole("option", { name: topic.title }).click()
    await expect(
      page.getByLabel("Message this chat").getByText(`@${topic.title}`),
    ).toBeVisible()
    const runtime = {
      runnerId: chat.runnerId,
      chatId: chat.id,
      status: "error" as const,
      activity: "Needs attention",
      error: "Test save failure",
      traceId: randomUUID(),
      diagnostics: [
        {
          time: new Date().toISOString(),
          event: "harness.failed",
          details: { error: "Test save failure" },
        },
      ],
    }
    await app.evaluate(
      ({ BrowserWindow }, snapshot) => {
        BrowserWindow.getAllWindows()[0].webContents.send(
          "prune:update",
          snapshot,
        )
      },
      { ...snapshot, runtime: [runtime] },
    )
    await expect(page.getByText(/^Diagnostics ·/)).toBeVisible()
    await app.evaluate(
      ({ BrowserWindow }, snapshot) => {
        BrowserWindow.getAllWindows()[0].webContents.send(
          "prune:update",
          snapshot,
        )
      },
      {
        ...snapshot,
        runtime: [{ ...runtime, status: "ready", error: undefined }],
      },
    )
    await expect(page.getByText(/^Diagnostics ·/)).toHaveCount(0)
    await page.screenshot({ path: "test-results/workspace.png" })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("native Claude and Antigravity providers save settings and commit validated lessons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-cli-native-"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ELECTRON_RENDERER_URL: _rendererUrl, ...environment } = process.env
  const launch = () => _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    for (const name of ["Claude", "Antigravity"] as const) {
      await page.getByRole("button", { name: "Add provider", exact: true }).click()
      await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click()
      await page.getByLabel("Binary path", { exact: true }).fill(executable)
      await page.getByRole("button", { name: "Save changes", exact: true }).click()
      await expect(page.getByRole("status")).toContainText("Saved")
      await page.getByRole("button", { name: "Check connection", exact: true }).click()
      await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible()
    }
    await page.screenshot({ path: "test-results/provider-editor.png" })
    for (const provider of ["claude", "antigravity"] as const) {
      const chatId = await page.evaluate(async (provider) => {
        const bridge = window.prune
        if (!bridge) throw new Error("Missing native bridge")
        const runnerId = await bridge.addRunner({ name: `${provider} tutor`, provider, model: "default" })
        const chatId = await bridge.createChat({ runnerId })
        await bridge.send({ chatId, content: "Teach me limits" })
        return chatId
      }, provider)
      await expect.poll(async () => page.evaluate(async (id) => {
        const snapshot = await window.prune?.snapshot()
        return snapshot?.chats.find((chat) => chat.id === id)?.messages.at(-1)?.role
      }, chatId)).toBe("assistant")
    }
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    for (const name of ["Claude", "Antigravity"] as const) {
      await page.getByRole("button", { name, exact: true }).click()
      await expect(page.getByLabel("Binary path", { exact: true })).toHaveValue(executable)
      await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible()
    }
    await page.getByRole("button", { name: "Disconnect", exact: true }).click()
    await expect(page.getByRole("button", { name: "Check connection", exact: true })).toBeVisible()
    const snapshot = await page.evaluate(async () => window.prune?.snapshot())
    expect(snapshot?.chats.filter((chat) => chat.messages.at(-1)?.role === "assistant")).toHaveLength(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
