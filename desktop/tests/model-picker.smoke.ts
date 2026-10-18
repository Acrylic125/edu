import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { ProviderStatusSchema } from "../src/shared/contracts"

test("picker exposes concrete provider defaults and keeps Luna in the primary list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-model-picker-"))
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({
    args: [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    await expect.poll(async () => page.evaluate(async () => {
      const snapshot = await window.prune?.snapshot()
      return snapshot && snapshot.providers.every((provider) => !provider.loading)
    }), { timeout: 30_000 }).toBe(true)
    const snapshot = await page.evaluate(async () => {
      if (!window.prune) throw new Error("Missing desktop bridge")
      return window.prune.snapshot()
    })
    const providers = [
      { id: "codex", name: "Codex", models: [
        { id: "gpt-6.1-sol", name: "GPT-6.1-Sol", isDefault: true },
        { id: "gpt-6-astra", name: "GPT-6-Astra" },
        { id: "gpt-6-sol", name: "GPT-6-Sol" },
        { id: "gpt-6-luna", name: "GPT-6-Luna" },
      ] },
      { id: "claude", name: "Claude", models: [
        { id: "sonnet", name: "Sonnet" },
        { id: "opus", name: "Opus" },
        { id: "claude-haiku-5-5", name: "Haiku 5.5" },
      ] },
      { id: "antigravity", name: "Antigravity", models: [
        { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
        { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
      ] },
    ].map((provider) => ProviderStatusSchema.parse({ ...provider, connected: true }))
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, { ...snapshot, providers })
    const trigger = page.getByRole("combobox", { name: "Choose provider and model" })
    await expect(trigger).toHaveText("GPT-6-Luna")
    await trigger.click()
    await expect(page.getByRole("option", { name: "GPT-6-Luna", exact: true })).toBeVisible()
    await expect(page.getByText("Default", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: /More models/ }).click()
    await expect(page.getByRole("option", { name: "Default model", exact: true })).toHaveCount(0)
    await page.getByRole("option", { name: "GPT-6-Astra", exact: true }).click()
    await trigger.click()
    await page.getByRole("button", { name: "Claude", exact: true }).click()
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-label", "Haiku 5.5")
    await page.getByRole("option", { name: "Haiku 5.5", exact: true }).click()
    await expect(trigger).toHaveText("Haiku 5.5")
    await trigger.click()
    await page.getByRole("button", { name: "Antigravity", exact: true }).click()
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-label", "Gemini 3.8 Flash (High)")
    await page.getByRole("option", { name: "Gemini 3.8 Flash (High)", exact: true }).click()
    await expect(trigger).toHaveText("Gemini 3.8 Flash (High)")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
