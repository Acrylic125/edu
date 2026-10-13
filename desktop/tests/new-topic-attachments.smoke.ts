import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"
import { WorkspaceRepository } from "../src/main/workspace"

async function launch() {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-attachments-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
  })
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...environment
  } = process.env
  const { PRUNE_PACKAGED_APP: executablePath } = z.object({
    PRUNE_PACKAGED_APP: z.string().optional(),
  }).parse(process.env)
  const app = await _electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  return { app, directory }
}

for (const content of ["", "Teach me limits"]) {
  test(`canceling new-topic attachments preserves ${content ? "a typed" : "an empty"} draft without creating a topic or chat`, async () => {
    const { app, directory } = await launch()
    try {
      const selection = app.evaluate(({ dialog }) => new Promise<void>((resolve) => {
        dialog.showOpenDialog = async () => {
          resolve()
          return { canceled: true, filePaths: [] }
        }
      }))
      const page = await app.firstWindow()
      const draft = page.getByRole("textbox", { name: "Message your tutor" })
      await expect(draft).toBeVisible()
      await draft.fill(content)
      await page.getByRole("button", { name: "Add learning materials" }).click()
      await selection
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      expect(snapshot?.topics).toHaveLength(0)
      expect(snapshot?.chats).toHaveLength(0)
      await expect(page.getByRole("button", { name: "Add learning materials" })).toBeEnabled()
      await expect(draft).toHaveText(content)
      await expect(page.getByRole("tab")).toHaveCount(0)
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test("new-topic files remain removable drafts until Send imports them into the new topic", async () => {
  const { app, directory } = await launch()
  const source = join(directory, "limits.txt")
  await writeFile(source, "The limit of x as x approaches zero is zero.")
  try {
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    const page = await app.firstWindow()
    const draft = page.getByRole("textbox", { name: "Message your tutor" })
    const attach = page.getByRole("button", { name: "Add learning materials" })
    await expect(draft).toBeVisible()
    await attach.click()
    const remove = page.getByRole("button", { name: "Remove limits.txt" })
    await expect(remove).toBeVisible()
    let snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics).toHaveLength(0)
    expect(snapshot?.chats).toHaveLength(0)
    await expect(draft).toHaveText("")
    await remove.click()
    await expect(remove).toHaveCount(0)
    await draft.fill("Teach me limits")
    await attach.click()
    await expect(remove).toBeVisible()
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await attach.click()
    await expect(attach).toBeEnabled()
    await expect(remove).toBeVisible()
    await expect(draft).toHaveText("Teach me limits")
    snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics).toHaveLength(0)
    expect(snapshot?.chats).toHaveLength(0)
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics).toHaveLength(1)
    expect(snapshot?.chats).toHaveLength(1)
    expect(snapshot?.topics[0].materials).toEqual([expect.objectContaining({ name: "limits.txt", kind: "text" })])
    const topicId = snapshot?.topics[0].id
    if (!topicId) throw new Error("Missing created topic")
    expect(await readFile(join(directory, "workspace", "topics", topicId, "assets", "limits.txt"), "utf8")).toBe(await readFile(source, "utf8"))
    await page.getByRole("button", { name: "New topic", exact: true }).click()
    await expect(draft).toHaveText("")
    await expect(remove).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("attached files alone enable Send and start a topic without typed text", async () => {
  const { app, directory } = await launch()
  const source = join(directory, "limits.txt")
  await writeFile(source, "Limits describe the value approached by a function.")
  try {
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    const page = await app.firstWindow()
    const composer = page.getByRole("form", { name: "New topic composer" })
    const send = composer.getByRole("button", { name: "Send message" })
    await expect(send).toBeDisabled()
    await composer.getByRole("button", { name: "Add learning materials" }).click()
    await expect(composer.getByRole("button", { name: "Remove limits.txt" })).toBeVisible()
    await expect(send).toBeEnabled({ timeout: 3000 })
    await composer.getByRole("button", { name: "Remove limits.txt" }).click()
    await expect(send).toBeDisabled()
    await composer.getByRole("button", { name: "Add learning materials" }).click()
    await expect(send).toBeEnabled()
    await send.click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics).toHaveLength(1)
    expect(snapshot?.topics[0].materials[0].name).toBe("limits.txt")
    expect(snapshot?.chats[0].messages[0].content).toContain("limits.txt")
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
