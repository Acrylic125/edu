import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

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
    expect(await app.evaluate(({ app }) => app.getName())).toBe("EdU")
    await expect(page.getByRole("button", { name: "EdU", exact: true })).toBeVisible()
    const appIcon = page.getByRole("button", { name: "EdU", exact: true }).locator("img")
    await expect(appIcon).toBeVisible()
    await expect.poll(() => appIcon.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)).toBe(true)
    const faviconUrl = await page.locator('link[rel="icon"]').evaluate(
      (link) => link instanceof HTMLLinkElement ? link.href : "",
    )
    expect(faviconUrl).toBe(
      await appIcon.evaluate((image) => image instanceof HTMLImageElement ? image.src : ""),
    )
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
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
    await page.getByText("Advanced settings", { exact: true }).click()
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
    await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Setup", exact: true })).toBeVisible()
    await expect(page.getByRole("option")).toHaveCount(0)
    await page.getByRole("button", { name: "OpenRouter", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Set up OpenRouter", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "OpenRouter", exact: true })).toBeEnabled()
    await expect(page.getByRole("button", { name: "OpenRouter", exact: true }).locator("svg")).toHaveCSS("filter", "grayscale(1)")
    await page.getByRole("button", { name: "Claude", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Set up Claude", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Open provider settings", exact: true }).click()
    await expect(page.getByRole("button", { name: "Providers", exact: true })).toHaveAttribute("aria-current", "page")
    await page.getByText("Advanced settings", { exact: true }).click()
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Claude")
    await expect(page.getByLabel("Binary path", { exact: true })).toHaveAttribute("placeholder", "/absolute/path/to/claude")
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect.poll(async () => page.evaluate(async () => {
      if (!window.prune) throw new Error("Missing desktop bridge")
      return (await window.prune.snapshot()).providers.every((provider) => !provider.loading && !provider.connecting)
    }), { timeout: 30_000 }).toBe(true)
    const pickerSnapshot = await page.evaluate(async () => {
      if (!window.prune) throw new Error("Missing desktop bridge")
      return window.prune.snapshot()
    })
    // Seed connection status without requiring account sign-in during UI coverage.
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", {
        ...snapshot,
        providers: snapshot.providers.map((provider) => ({
          ...provider,
          connected: provider.id === "codex" || provider.id === "openrouter",
        })),
      })
    }, pickerSnapshot)
    await modelTrigger.click()
    await expect(page.getByRole("heading", { name: "Setup", exact: true })).toHaveCount(0)
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
    await expect(page.getByRole("button", { name: "Favorites", exact: true })).toHaveCount(0)
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
    await expect(page.getByLabel("Message your tutor")).toHaveText("Teach me calculus")
    const repository = new WorkspaceRepository(join(directory, "workspace"))
    await repository.load()
    const seeded = newTopic("Teach me calculus")
    await repository.mutate((state) => state.topics.push(seeded))
    await page.evaluate(async () => {
      const bridge = window.prune
      if (!bridge) throw new Error("Missing desktop bridge")
      const snapshot = await bridge.snapshot()
      await bridge.createChat({ runnerId: snapshot.runners[0].id })
    })
    await page.getByRole("button", { name: "Teach me calculus", exact: true }).click()
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
    await expect(tutorChat).toBeVisible()
    await expect(page.getByLabel("Message your tutor")).toBeVisible()
    await expect(page.getByRole("tab", { name: "New topic", exact: true })).toHaveCount(0)
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
  const launch = () => _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    for (const name of ["Claude", "Antigravity"] as const) {
      await page.getByRole("button", { name: "Add provider", exact: true }).click()
      await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click()
      await page.getByText("Advanced settings", { exact: true }).click()
      await page.getByLabel("Binary path", { exact: true }).fill(executable)
      await page.getByRole("button", { name: "Save changes", exact: true }).click()
      await expect(page.getByRole("status")).toContainText("Saved")
      await page.getByRole("button", { name: "Connect", exact: true }).click()
      await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible()
    }
    await page.screenshot({ path: "test-results/provider-editor.png" })
    for (const provider of ["claude", "antigravity"] as const) {
      const chatId = await page.evaluate(async (provider) => {
        const bridge = window.prune
        if (!bridge) throw new Error("Missing native bridge")
        const runnerId = await bridge.addRunner({ name: `${provider} tutor`, provider, model: "default" })
        const topicId = await bridge.createTopic({ title: "Teach me limits", runnerId })
        const snapshot = await bridge.snapshot()
        const topic = snapshot.topics.find((item) => item.id === topicId)
        if (topic?.title !== "Introduction to Limits") throw new Error("Topic title was not generated before creation")
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
      await page.getByText("Advanced settings", { exact: true }).click()
      await expect(page.getByLabel("Binary path", { exact: true })).toHaveValue(executable)
      await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible()
    }
    await page.getByRole("button", { name: "Disconnect", exact: true }).click()
    await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
    const snapshot = await page.evaluate(async () => window.prune?.snapshot())
    expect(snapshot?.chats.filter((chat) => chat.messages.at(-1)?.role === "assistant")).toHaveLength(2)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("existing chats can set up unconnected providers directly from the model picker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-provider-setup-"))
  const bin = join(directory, "bin")
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await mkdir(bin)
  await symlink(executable, join(bin, "claude"))
  await symlink(executable, join(bin, "agy"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  const runnerId = randomUUID()
  await repository.load()
  await repository.mutate((workspace) => {
    workspace.runners.push({ id: runnerId, name: "Tutor", provider: "codex", model: "default" })
    workspace.chats.push(newChat(runnerId, "Existing chat"))
  })
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ELECTRON_RENDERER_URL: _rendererUrl, ...environment } = process.env
  const app = await _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PATH: `${bin}:${environment.PATH}`, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("tab", { name: "Existing chat", exact: true })).toBeVisible()
    await page.getByTestId("workspace-chat-panel").getByRole("combobox", { name: "Choose provider and model" }).click()
    for (const name of ["Claude", "Antigravity"] as const) {
      const provider = page.getByRole("button", { name, exact: true })
      await expect(provider).toBeEnabled({ timeout: 3000 })
      await provider.click()
      const setup = page.getByRole("region", { name: `Set up ${name}` })
      await expect(setup.getByRole("heading", { name: "Setup", exact: true })).toBeVisible()
      await expect(setup.getByRole("img", { name: "Installation complete", exact: true })).toBeVisible()
      await expect(setup.getByRole("listitem")).toHaveCount(2)
      await setup.getByRole("button", { name: "Connect", exact: true }).click()
      await expect(page.getByText(`Start a new chat to use ${name}.`, { exact: true })).toBeVisible()
      await expect(provider).toHaveAttribute("aria-description", "Connected")
      await expect(page.getByRole("dialog", { name: "Choose a model" }).getByRole("option")).toHaveCount(0)
    }
    await page.keyboard.press("Escape")
    const snapshot = await page.evaluate(async () => {
      if (!window.prune) throw new Error("Missing desktop bridge")
      return window.prune.snapshot()
    })
    expect(snapshot.runners.find((runner) => runner.id === runnerId)?.provider).toBe("codex")
    expect(snapshot.providers.find((provider) => provider.id === "claude")?.settings?.binaryPath).toBe(join(bin, "claude"))
    expect(snapshot.providers.find((provider) => provider.id === "antigravity")?.settings?.binaryPath).toBe(join(bin, "agy"))
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("provider settings show simple setup and keep failures beside the controls without moving the page", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-settings-feedback-"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  await repository.mutate((workspace) => {
    workspace.providerSettings.push(
      { id: "antigravity", displayName: "Antigravity", binaryPath: executable, enabled: false },
      { id: "claude", displayName: "Claude", binaryPath: executable, enabled: false },
    )
  })
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ELECTRON_RENDERER_URL: _rendererUrl, ...environment } = process.env
  const app = await _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory, EDU_TEST_CLI_FAIL_CONNECTION: "1" },
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    await page.getByRole("button", { name: "Antigravity", exact: true }).click()
    const connection = page.getByRole("region", { name: "Antigravity connection" })
    await expect(connection.getByRole("heading", { name: "Setup", exact: true })).toBeVisible()
    await expect(connection.getByRole("listitem")).toHaveCount(2)
    await expect(connection.getByRole("img", { name: "Installation complete", exact: true })).toBeVisible()
    const heading = page.getByRole("heading", { name: "Provider", exact: true })
    const connect = connection.getByRole("button", { name: "Connect", exact: true })
    const beforeHeading = await heading.boundingBox()
    const beforeConnect = await connect.boundingBox()
    await connect.click()
    await expect(connection.getByRole("alert")).toContainText("The provider exited unsuccessfully")
    await expect(connection.getByRole("alert")).not.toContainText("Error invoking remote method")
    expect(await heading.boundingBox()).toEqual(beforeHeading)
    expect(await connect.boundingBox()).toEqual(beforeConnect)
    await page.getByText("Advanced settings", { exact: true }).click()
    const save = page.getByRole("button", { name: "Save changes", exact: true })
    const beforeSave = await save.boundingBox()
    await page.getByLabel("Binary path", { exact: true }).fill("not-an-absolute-path")
    await save.click()
    await expect(page.getByRole("form", { name: "Antigravity settings" }).getByRole("alert")).toHaveText("Enter an absolute binary path.")
    expect(await heading.boundingBox()).toEqual(beforeHeading)
    expect(await connect.boundingBox()).toEqual(beforeConnect)
    expect(await save.boundingBox()).toEqual(beforeSave)
    await page.getByRole("button", { name: "Claude", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveCount(0)
    await page.getByRole("button", { name: "Appearance", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("provider setup rechecks installation and shows completion beside each step and provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-setup-checks-"))
  const bin = join(directory, "bin")
  const binaryPath = join(bin, "agy")
  await mkdir(bin)
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  await repository.mutate((workspace) => {
    workspace.providerSettings.push({ id: "antigravity", displayName: "Antigravity", binaryPath, enabled: false })
  })
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ELECTRON_RENDERER_URL: _rendererUrl, ...environment } = process.env
  const app = await _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("button", { name: "Providers", exact: true }).click()
    const connection = page.getByRole("region", { name: "Antigravity connection" })
    const recheck = connection.getByRole("button", { name: "Recheck Antigravity setup", exact: true })
    const provider = page.getByRole("button", { name: "Antigravity", exact: true })
    await expect(connection.getByRole("img", { name: "Installation incomplete", exact: true })).toBeVisible()
    await expect(connection.getByRole("link", { name: "Install CLI", exact: true })).toBeVisible()
    await expect(recheck).toBeEnabled()
    await symlink(executable, binaryPath)
    await recheck.click()
    await expect(connection.getByRole("img", { name: "Installation complete", exact: true })).toBeVisible()
    await expect(connection.getByText("CLI installed", { exact: true })).toBeVisible()
    await expect(connection.getByRole("img", { name: "Account not connected", exact: true })).toBeVisible()
    await connection.getByRole("button", { name: "Connect", exact: true }).click()
    await expect(connection.getByRole("img", { name: "Account connected", exact: true })).toBeVisible()
    await expect(provider).toHaveAttribute("aria-description", "Connected")
    await expect(provider.locator("svg")).toBeVisible()
    await expect(page.getByText("All providers are checked every 5 minutes.", { exact: true })).toBeVisible()
    await rm(binaryPath)
    await recheck.click()
    await expect(connection.getByRole("img", { name: "Installation incomplete", exact: true })).toBeVisible()
    await expect(connection.getByRole("img", { name: "Account not connected", exact: true })).toBeVisible()
    await expect(provider).toHaveAttribute("aria-description", "Setup incomplete")
    await expect(provider.locator("svg")).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
