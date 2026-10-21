import { randomUUID } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { renderPageAsImage } from "unpdf"
import { createCanvas } from "@napi-rs/canvas"
import { _electron, expect, test } from "@playwright/test"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

test("chat displays source diagrams and opens original materials from citations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-source-links-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const topic = newTopic("Instruction Set Architecture")
  const id = randomUUID()
  const name = "Lecture 6 - MIPS Part 1 (full set).pdf"
  topic.materials.push({ id, name, kind: "pdf", text: "Limits diagram", pages: ["Limits diagram"] })
  const chat = newChat(repository.stateSnapshot.runners[0].id, "Lecture diagrams")
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain this diagram", topicIds: [topic.id], createdAt: new Date().toISOString() })
  chat.messages.push({
    id: randomUUID(), role: "assistant", topicIds: [], createdAt: new Date().toISOString(),
    content: `## Lecture diagram\n\n![Lecture diagram](prune-source://${id}/1)\n\n*Sourced from: Lecture 6.pdf, pg. 1.*\n\nSourced from: [Lecture 6.pdf, pg. 1.](<assets/${name}#page=1>)\n\nSourced from: [Lecture 6.pdf, pg. 1.](edu-material://${id}/1)`,
  })
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.topics.push(topic)
    state.chats.push(chat)
  })
  const assets = join(repository.directory, "scratchpads", topic.id, "assets")
  await mkdir(assets, { recursive: true })
  const pdf = await readFile(resolve("tests/fixtures/diagram.pdf"))
  await copyFile(resolve("tests/fixtures/diagram.pdf"), join(assets, name))
  const image = await renderPageAsImage(new Uint8Array(pdf), 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.3 })
  await writeFile(join(assets, `source-${id}-1.png`), createCanvas(300, 300).toBuffer("image/png"))
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    const diagram = page.getByRole("button", { name: "Magnify Lecture diagram", exact: true })
    await expect(diagram).toBeVisible()
    await expect.poll(() => diagram.evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth > 0)).toBe(true)
    expect((await readFile(join(assets, `source-${id}-1.png`))).equals(Buffer.from(image))).toBe(true)
    const links = page.getByRole("link", { name: /^Lecture 6\.pdf, pg\. 1\.?$/ })
    await expect(links).toHaveCount(3)
    await app.evaluate(({ shell }) => {
      shell.openPath = async (path) => {
        process.env.EDU_TEST_OPENED_SOURCE = path
        return ""
      }
    })
    for (const link of await links.all()) {
      await app.evaluate(() => { delete process.env.EDU_TEST_OPENED_SOURCE })
      await link.click()
      await expect.poll(() => app.evaluate(() => process.env.EDU_TEST_OPENED_SOURCE)).toBe(join(assets, name))
    }
    await page.getByRole("button", { name: topic.title, exact: true }).click()
    await app.evaluate(() => { delete process.env.EDU_TEST_OPENED_SOURCE })
    await page.getByTitle(`Open ${name}`, { exact: true }).click()
    await expect.poll(() => app.evaluate(() => process.env.EDU_TEST_OPENED_SOURCE)).toBe(join(assets, name))
    expect(await page.evaluate(() => {
      if (!window.prune) throw new Error("Desktop bridge is missing")
      return window.prune.openMaterial("../../outside.pdf").then(() => "opened", () => "rejected")
    })).toBe("rejected")
    await page.screenshot({ path: "test-results/source-links.png" })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
