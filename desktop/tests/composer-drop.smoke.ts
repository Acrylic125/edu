import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { z } from "zod"
import { newChat, WorkspaceRepository } from "../src/main/workspace"

test("dropping native files into topic and chat composers attaches them without opening the picker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-composer-drop-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const chat = newChat(repository.stateSnapshot.runners[0].id, "Existing chat")
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.chats.push(chat)
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
  })
  const source = join(directory, "notes.txt")
  const code = join(directory, "example.ts")
  const slides = resolve("tests/fixtures/materials/lecture.pptx")
  await writeFile(source, "Notes about limits")
  await writeFile(code, "const limit = 0")
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
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => {
        throw new Error("Dropping files must not open the picker")
      }
    })
    const page = await app.firstWindow()
    await page.getByRole("button", { name: "New scratchpad", exact: true }).click()
    const topicDraft = page.getByRole("textbox", { name: "Message your tutor" })
    await expect(topicDraft).toBeVisible()
    await topicDraft.fill("Teach me limits")
    // A native input provides real File objects with paths, unlike new File() in the renderer.
    await page.evaluate(() => {
      const input = document.createElement("input")
      input.type = "file"
      input.multiple = true
      input.id = "drop-fixture"
      document.body.append(input)
    })
    await page.locator("#drop-fixture").setInputFiles([source, code, slides])
    const transfer = await page.evaluateHandle(() => {
      const input = document.querySelector("#drop-fixture")
      if (!(input instanceof HTMLInputElement) || !input.files?.[0])
        throw new Error("Missing native file fixture")
      const transfer = new DataTransfer()
      for (const file of input.files) transfer.items.add(file)
      return transfer
    })
    await topicDraft.dispatchEvent("dragover", { dataTransfer: transfer })
    await expect(page.getByRole("status").filter({ hasText: "Drop files to attach" })).toBeVisible()
    await topicDraft.dispatchEvent("dragleave", { dataTransfer: transfer })
    await expect(page.getByText("Drop files to attach", { exact: true })).toHaveCount(0)
    await topicDraft.dispatchEvent("dragover", { dataTransfer: transfer })
    await topicDraft.dispatchEvent("drop", { dataTransfer: transfer })
    await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeVisible({ timeout: 3000 })
    await expect(page.getByRole("button", { name: "Remove example.ts" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Remove lecture.pptx" })).toBeVisible()
    await expect(page.getByText("Drop files to attach", { exact: true })).toHaveCount(0)
    await expect(topicDraft).toHaveText("Teach me limits")
    const snapshot = await page.evaluate(() => window.prune?.snapshot())
    expect(snapshot?.topics).toHaveLength(0)
    expect(snapshot?.chats).toHaveLength(1)
    expect(snapshot?.chats[0].materials).toHaveLength(0)
    await topicDraft.dispatchEvent("drop", { dataTransfer: transfer })
    await expect(page.getByRole("alert")).toContainText("already attached")
    await expect(page.getByRole("button", { name: "Remove notes.txt" })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Remove example.ts" })).toHaveCount(1)
    await page.getByRole("button", { name: "Remove notes.txt" }).click()
    await page.getByRole("button", { name: "Remove example.ts" }).click()
    await page.getByRole("button", { name: "Remove lecture.pptx" }).click()
    const chatDraft = page.getByRole("textbox", { name: "Message this chat" })
    await chatDraft.fill("Explain these notes")
    await chatDraft.dispatchEvent("dragover", { dataTransfer: transfer })
    await chatDraft.dispatchEvent("drop", { dataTransfer: transfer })
    await expect(chatDraft.locator("xpath=ancestor::form").getByText("notes.txt", { exact: true })).toHaveCount(0)
    await expect(chatDraft).toHaveText("Explain these notes")
    await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.chats[0].materials.length).toBe(3)
    expect((await page.evaluate(() => window.prune?.snapshot()))?.chats[0].materials)
      .toEqual([
        expect.objectContaining({ name: "notes.txt", kind: "text" }),
        expect.objectContaining({ name: "example.ts", kind: "text" }),
        expect.objectContaining({ name: "lecture.pptx", kind: "text" }),
      ])
    expect(await readFile(join(directory, "workspace", "chats", chat.id, "assets", "notes.txt"), "utf8"))
      .toBe("Notes about limits")
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await chatDraft.fill("A new chat draft")
    await chatDraft.dispatchEvent("drop", { dataTransfer: transfer })
    await expect(chatDraft.locator("xpath=ancestor::form").getByText("notes.txt", { exact: true })).toHaveCount(0)
    await expect(chatDraft).toHaveText("A new chat draft")
    await expect.poll(async () => (await page.evaluate(() => window.prune?.snapshot()))?.chats[0].materials.length).toBe(3)
    const afterNewChat = await page.evaluate(() => window.prune?.snapshot())
    expect(afterNewChat?.chats).toHaveLength(2)
    expect(afterNewChat?.chats[0].materials).toHaveLength(3)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
