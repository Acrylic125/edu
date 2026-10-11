import { mkdtemp, rm } from "node:fs/promises"
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
      page.getByRole("heading", { name: /Drop in slides/ }),
    ).toBeVisible()
    await page.screenshot({ path: "test-results/welcome.png" })
    expect(await page.evaluate(() => typeof window.prune?.send)).toBe(
      "function",
    )
    expect(await page.evaluate(() => "require" in window)).toBe(false)
    await page.getByRole("button", { name: /^Runners/ }).click()
    await expect(
      page.getByRole("heading", { name: "Your runners" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Sign in with ChatGPT" }),
    ).toBeVisible()
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
    await page.getByLabel("Appearance", { exact: true }).selectOption("dark")
    await expect(page.locator("html")).toHaveClass("dark")
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    const modelTrigger = page.getByRole("combobox", {
      name: "Choose provider and model",
    })
    await modelTrigger.click()
    await page.getByRole("button", { name: "OpenRouter", exact: true }).click()
    await page.getByRole("option", { name: "Auto", exact: true }).click()
    await expect(modelTrigger).toHaveText(/Auto/)
    await expect(page.getByRole("listbox")).not.toBeVisible()
    await modelTrigger.click()
    await page.getByRole("button", { name: "Codex", exact: true }).click()
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
    await expect(page.getByRole("listbox")).not.toBeVisible()
    await page.getByRole("button", { name: "Choose reasoning effort" }).click()
    await page
      .getByRole("menuitemradio", {
        name: `${codexModel.effort} reasoning`,
        exact: true,
      })
      .click()
    await expect(page.getByRole("menu")).not.toBeVisible()
    await modelTrigger.click()
    await page.screenshot({ path: "test-results/model-picker.png" })
    await page
      .locator('[aria-label="Choose a model"]')
      .screenshot({ path: "test-results/model-menu.png" })
    await page.keyboard.press("Escape")
    await expect(modelTrigger).toBeFocused()
    await modelTrigger.click()
    await page.getByRole("heading", { name: /Drop in slides/ }).click()
    await expect(page.getByRole("listbox")).not.toBeVisible()
    await modelTrigger.click()
    await page
      .getByRole("option", { name: "Default model", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Choose reasoning effort" }),
    ).not.toBeVisible()
    await page.screenshot({ path: "test-results/welcome-dark.png" })
    await page.getByRole("button", { name: /^Runners/ }).click()
    await page.getByLabel("Appearance", { exact: true }).selectOption("light")
    await expect(page.locator("html")).not.toHaveClass("dark")
    await page.getByRole("button", { name: "Start", exact: true }).click()
    await expect(page.getByText("Ready", { exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.prune?.snapshot())?.runtime[0].pid ?? 0,
        ),
      )
      .toBeGreaterThan(0)
    await page.getByRole("button", { name: "Stop", exact: true }).click()
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Add runner", exact: true }).click()
    await page.getByLabel("Name", { exact: true }).fill("Physics tutor")
    const runnerDialog = page.locator("dialog[open]")
    await runnerDialog
      .getByRole("combobox", { name: "Choose provider and model" })
      .click()
    await page
      .getByRole("option", { name: codexModel.name, exact: true })
      .click()
    await runnerDialog
      .getByRole("button", { name: "Choose reasoning effort" })
      .click()
    await page
      .getByRole("menuitemradio", {
        name: `${codexModel.effort} reasoning`,
        exact: true,
      })
      .click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add runner", exact: true })
      .click()
    await expect(
      page.getByRole("heading", { name: "Physics tutor" }),
    ).toBeVisible()
    await page.screenshot({ path: "test-results/runners.png" })
    const physics = page
      .getByRole("heading", { name: "Physics tutor" })
      .locator("xpath=ancestor::section")
    await physics.getByRole("button", { name: "Edit Physics tutor" }).click()
    await expect(
      runnerDialog.getByRole("combobox", { name: "Choose provider and model" }),
    ).toHaveText(codexModel.name)
    await runnerDialog
      .getByRole("button", { name: "Choose reasoning effort" })
      .click()
    await expect(
      page.getByRole("menuitemradio", {
        name: `${codexModel.effort} reasoning`,
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("Escape")
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save changes" })
      .click()
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
    await page.getByRole("button", { name: "Add learning materials" }).click()
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
    const snapshot = await page.evaluate(async () => window.prune?.snapshot())
    const topic = snapshot?.topics.find(
      (topic) => topic.title === "Teach me calculus",
    )
    if (!snapshot || !topic) throw new Error("Missing restored topic")
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
    const runtime = {
      runnerId: topic.runnerId,
      topicId: topic.id,
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
