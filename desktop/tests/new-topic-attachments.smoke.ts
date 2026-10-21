import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"
import { newTopic, WorkspaceRepository } from "../src/main/workspace"

async function launch(existingTopic = false) {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-attachments-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    if (existingTopic) state.topics.push(newTopic("Existing calculus"))
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

test("a stalled file selection can be canceled and retried without losing the draft", async () => {
  const { app, directory } = await launch()
  const source = join(directory, "diagram.pdf")
  await writeFile(source, await readFile(resolve("tests/fixtures/diagram.pdf")))
  try {
    await app.evaluate(({ dialog, ipcMain }, source) => {
      dialog.showOpenDialog = () => new Promise((resolve) => {
        ipcMain.once("finish-stalled-selection", () => resolve({ canceled: false, filePaths: [source] }))
      })
    }, source)
    const page = await app.firstWindow()
    const draft = page.getByRole("textbox", { name: "Message your tutor" })
    await draft.fill("Walk me through MIPS and pause at section 3")
    await page.getByRole("button", { name: "Add learning materials" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Waiting for file selection" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Learn calculus/ })).toBeEnabled()
    await page.getByRole("button", { name: "Cancel file selection", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "File selection canceled" })).toBeVisible()
    await expect(draft).toHaveText("Walk me through MIPS and pause at section 3")
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => { throw new Error("The file picker could not open.") }
    })
    await page.getByRole("button", { name: "Retry attaching files", exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: "The file picker could not open." })).toBeVisible()
    await app.evaluate(({ ipcMain }) => { ipcMain.emit("finish-stalled-selection") })
    await expect(page.getByRole("button", { name: "Remove diagram.pdf" })).toHaveCount(0)
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    await page.getByRole("button", { name: "Retry attaching files", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove diagram.pdf" })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(draft).toHaveText("Walk me through MIPS and pause at section 3")
    expect((await page.evaluate(() => window.prune!.snapshot())).chats).toHaveLength(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("a new plan recovers from read-only and pre-confirmation writes without teaching", async () => {
  const { app, directory } = await launch(true)
  try {
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    await page.getByRole("textbox", { name: "Message your tutor" }).fill("Help me learn calculus; propose a fresh plan.")
    await page.getByRole("button", { name: "Send message", exact: true }).click()
    await expect(page.getByText("Here is your learning plan. Confirm it to begin.", { exact: true })).toBeVisible()
    await expect(page.locator('[data-message-role="assistant"]').last().getByRole("button", { name: "Confirm plan & begin", exact: true })).toBeVisible()
    const snapshot = await page.evaluate(() => window.prune!.snapshot())
    expect(snapshot.topics).toHaveLength(2)
    expect(snapshot.runtime.every((runtime) => runtime.status === "ready")).toBe(true)
    for (const topic of snapshot.topics) {
      expect(topic.planConfirmed).toBe(false)
      expect(topic.state?.type).toBe("topic")
      if (topic.state?.type === "topic") expect(topic.state.threadTutors.every((thread) => Object.keys(thread.progress).length === 0)).toBe(true)
    }
    expect(snapshot.chats[0].scratchpadRequested).toBe(false)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

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
  const source = join(directory, "diagram.pdf")
  await writeFile(source, await readFile(resolve("tests/fixtures/diagram.pdf")))
  try {
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    const page = await app.firstWindow()
    const draft = page.getByRole("textbox", { name: "Message your tutor" })
    const attach = page.getByRole("button", { name: "Add learning materials" })
    await expect(draft).toBeVisible()
    await attach.click()
    const remove = page.getByRole("button", { name: "Remove diagram.pdf" })
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
    const sentFile = page.locator('[data-message-role="user"]').first().getByRole("button", { name: "diagram.pdf", exact: true })
    await expect(sentFile).toBeVisible()
    expect(snapshot?.chats[0].messages[0].materialIds).toEqual([snapshot?.topics[0].materials[0].id])
    await app.evaluate(({ shell }) => {
      shell.openPath = async (path) => {
        process.env.EDU_TEST_OPENED_ATTACHMENT = path
        return ""
      }
    })
    await sentFile.click()
    await expect.poll(() => app.evaluate(() => process.env.EDU_TEST_OPENED_ATTACHMENT)).toContain("diagram.pdf")
    await page.reload()
    await expect(sentFile).toBeVisible()
    expect(snapshot?.topics).toHaveLength(1)
    expect(snapshot?.chats).toHaveLength(1)
    expect(snapshot?.topics[0].materials).toEqual([expect.objectContaining({ name: "diagram.pdf", kind: "pdf" })])
    const topicId = snapshot?.topics[0].id
    if (!topicId) throw new Error("Missing created topic")
    expect(await readFile(join(directory, "workspace", "scratchpads", topicId, "assets", "diagram.pdf"))).toEqual(await readFile(source))
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
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
    const composer = page.getByRole("form", { name: "New scratchpad composer" })
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

for (const type of ["topic", "test", "generic"] as const) {
  test(`new scratchpad creation infers ${type} from chat without a selector`, async () => {
    const { app, directory } = await launch()
    let closed = false
    try {
      const page = await app.firstWindow()
      const composer = page.getByRole("form", { name: "New scratchpad composer" })
      await expect(page.getByRole("combobox", { name: "Scratchpad type" })).toHaveCount(0)
      let request = "Teach me limits"
      if (type === "test") request = "Test me on limits"
      else if (type === "generic") request = "Keep free-form reading notes for me"
      await page.getByRole("textbox", { name: "Message your tutor" }).fill(request)
      await composer.getByRole("button", { name: "Send message" }).click()
      await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.topics[0]?.state?.type).toBe(type)
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      expect(snapshot?.topics).toHaveLength(1)
      const scratchpad = snapshot?.topics[0]
      if (!scratchpad) throw new Error("Missing created scratchpad")
      expect(scratchpad.planConfirmed).toBe(type !== "topic")
      expect(snapshot?.chats[0].scratchpadRequested).toBe(false)
      expect(snapshot?.chats[0].messages[0].content).toBe(request)
      await expect(page.getByRole("heading", { name: scratchpad.title, exact: true })).toBeVisible()
      await expect(page.getByText(type, { exact: true })).toHaveCount(0)
      const state = JSON.parse(await readFile(join(directory, "workspace", "scratchpads", scratchpad.id, "scratchpad.state.json"), "utf8"))
      expect(state.type).toBe(type)
      expect(await readFile(join(directory, "workspace", "scratchpads", scratchpad.id, "scratchpad.md"), "utf8")).toContain(`# ${scratchpad.title}`)
      await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.chats[0]?.messages.at(-1)?.role).toBe("assistant")
      await app.close()
      closed = true
      const reloaded = new WorkspaceRepository(join(directory, "workspace"))
      await reloaded.load()
      expect(reloaded.topic(scratchpad.id).state?.type).toBe(type)
    } finally {
      if (!closed) await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}
