import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"

test("provider setup offers only ChatGPT, Claude, and Antigravity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-provider-removal-"))
  const { ELECTRON_RENDERER_URL: _renderer, ELECTRON_RUN_AS_NODE: _node, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible({ timeout: 30_000 })
    const providers = page.getByRole("region", { name: "Choose a provider" })
    for (const name of ["ChatGPT", "Claude", "Antigravity"]) {
      await expect(providers.getByRole("button", { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole("button", { name: "OpenRouter", exact: true })).toHaveCount(0)
    const ids = await page.evaluate(async () => (await window.prune?.snapshot())?.providers.map((provider) => provider.id))
    expect(ids).toEqual(["codex", "claude", "antigravity"])
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
