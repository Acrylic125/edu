import { randomUUID } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"
import { _electron, expect, test } from "@playwright/test"
import { newTopic, WorkspaceRepository } from "../src/main/workspace"
import { StateService } from "../src/main/state-service"

test("Lecture 8 directory targets survive rewritten headings and spaced citations open their files after reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-navigation-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  const topic = newTopic("Lecture 8 — MIPS Part 3")
  const pdf = { id: randomUUID(), name: "Lecture 8 - MIPS Part 3.pdf", kind: "pdf" as const, text: "Instruction encoding", pages: ["Instruction encoding"] }
  const slides = { id: randomUUID(), name: "Lecture 8 - MIPS Part 3.pptx", kind: "text" as const, text: "Instruction encoding", pages: ["Instruction encoding"] }
  topic.materials.push(pdf, slides)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    state.topics.push(topic)
  })
  const assets = join(repository.directory, "scratchpads", topic.id, "assets")
  await mkdir(assets, { recursive: true })
  await copyFile(resolve("tests/fixtures/diagram.pdf"), join(assets, pdf.name))
  await copyFile(resolve("tests/fixtures/materials/lecture.pptx"), join(assets, slides.name))
  const parts = [
    { id: "tp-overview", name: "1. Overview and Motivation", heading: "A machine instruction from an assembly command" },
    { id: "tp-encoding", name: "2. MIPS Encoding: Basics", heading: "Fitting the instruction into 32 bits" },
    { id: "tp-classification", name: "3. MIPS Instruction Classification", heading: "Classifying instructions by their operands" },
  ]
  const service = new StateService(repository, "navigation-test")
  await service.updateTopic(topic.id, {
    content: parts.map(({ id, name }) => ({
      id, name, goals: [], mistakes: [],
      references: [{ type: "pdf", path: `assets/${pdf.name}`, pages: [{ from: 1, to: 1 }] }],
    })),
  })
  await service.write({ type: "editTopicContent", topicId: topic.id, changes: parts.map((part) => ({ action: "add", block: {
    type: "markdown", id: `example-${part.id}`, sectionId: part.id, content: [`## ${part.heading}`, "", "The instruction encodes an operation and its registers.\n\n".repeat(12), `Source: [Lecture 8 PDF, p. 1](<assets/${pdf.name}#page=1>), [Lecture 8 PPTX, p. 1](<assets/${slides.name}#page=1>)`],
  } })) })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const { PRUNE_PACKAGED_APP: executablePath } = z.object({
    PRUNE_PACKAGED_APP: z.string().optional(),
  }).parse(environment)
  const app = await _electron.launch({
    executablePath,
    args: executablePath ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    for (const reload of [false, true]) {
      if (reload) await page.reload()
      await page.getByRole("navigation", { name: "Your scratchpads" }).getByRole("button", { name: topic.title, exact: true }).click()
      await app.evaluate(({ shell }) => {
        shell.openPath = async (path) => {
          process.env.EDU_TEST_OPENED_SOURCE = path
          return ""
        }
      })
      await page.evaluate(() => {
        const scroll = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function (options) {
          document.body.dataset.scrolledTo = this.id
          scroll.call(this, options)
        }
      })
      const nav = page.getByRole("navigation", { name: "Topic directory", exact: true })
      for (const part of parts) {
        await nav.getByRole("button", { name: part.name, exact: true }).click()
        await expect(page.locator("body")).toHaveAttribute("data-scrolled-to", part.id)
      }
      for (const [label, material] of [["Lecture 8 PDF, p. 1", pdf], ["Lecture 8 PPTX, p. 1", slides]] as const) {
        await app.evaluate(() => { delete process.env.EDU_TEST_OPENED_SOURCE })
        await page.getByRole("link", { name: label, exact: true }).click()
        await expect.poll(() => app.evaluate(() => process.env.EDU_TEST_OPENED_SOURCE)).toBe(join(assets, material.name))
      }
      await app.evaluate(() => { delete process.env.EDU_TEST_OPENED_SOURCE })
      await nav.getByRole("link", { name: "Lecture 8.pdf, pg. 1", exact: true }).first().click()
      await expect.poll(() => app.evaluate(() => process.env.EDU_TEST_OPENED_SOURCE)).toBe(join(assets, pdf.name))
    }
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
