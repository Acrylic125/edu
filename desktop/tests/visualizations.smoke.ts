import { randomUUID } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import type { PlotlyHTMLElement } from "plotly.js"
import { newChat, newTopic, WorkspaceRepository } from "../src/main/workspace"

const line = `<visualization settings='{"type":"Plotly.js","data":[{"type":"scatter","mode":"lines+markers","x":[-2,-1,0,1,2],"y":[4,1,0,1,4]}],"layout":{"title":{"text":"Quadratic function"}}}' />`
const longTitle = "A long descriptive title explaining how the quadratic function changes as its input moves across the horizontal axis"
const matrix = `<visualization settings='{"type":"Plotly.js","data":[{"type":"heatmap","z":[[1,2],[3,4]]}],"layout":{"title":{"text":"Matrix values"}}}' />`
const surface = `<visualization settings='{"type":"Plotly.js","data":[{"type":"surface","x":[-1,0,1],"y":[-1,0,1],"z":[[2,1,2],[1,0,1],[2,1,2]]}],"layout":{"title":{"text":"3D surface"}}}' />`

test("local 2D and 3D visualizations interact, expand and persist in chat and topic notes", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-visualizations-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  await repository.mutate((state) => {
    state.runners[0].provider = "claude"
    state.providerSettings.push({ id: "claude", displayName: "Fixture tutor", binaryPath: executable, enabled: true })
    const chat = newChat(state.runners[0].id, "Interactive plots")
    chat.messages.push({ id: randomUUID(), role: "assistant", content: `A function.\n\n${line}\n\nA matrix.\n\n${matrix}\n\nA surface.\n\n${surface}\n\n<visualization settings='{}' />`, createdAt: new Date().toISOString(), topicIds: [] })
    state.chats.push(chat)
    const topic = newTopic("Plotting")
    topic.planConfirmed = true
    topic.learning.notes = `# Plotting\n\n<topic-directory heading="Topic directory" items='[{"title":"Functions"}]' />\n\n## Functions\n\n${line.replace("Quadratic function", longTitle)}`
    state.topics.push(topic)
  })
  const { ELECTRON_RENDERER_URL: _rendererUrl, ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env
  const app = await _electron.launch({ args: [resolve(".")], env: { ...environment, PRUNE_DATA_DIR: directory } })
  try {
    const page = await app.firstWindow()
    const failures: string[] = []
    const externalRequests: string[] = []
    page.on("pageerror", (error) => failures.push(error.message))
    page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()) })
    page.on("request", (request) => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()) })
    const plot = (name: string) => page.getByRole("figure", { name, exact: true })
    const quadratic = plot("Quadratic function")
    await expect(quadratic.locator(".scatterlayer .trace")).toBeAttached()
    await quadratic.scrollIntoViewIfNeeded()
    const point = await quadratic.locator(".scatterlayer .point").nth(2).boundingBox()
    if (!point) throw new Error("Missing plot point")
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
    await expect(quadratic.locator(".hoverlayer .hovertext")).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("plotly-2d.png") })
    const initialRange = await quadratic.locator(".js-plotly-plot").evaluate((node) => JSON.stringify((node as PlotlyHTMLElement).layout.xaxis?.range))
    const area = await quadratic.locator(".nsewdrag").boundingBox()
    if (!area) throw new Error("Missing zoom interaction area")
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(area.x + area.width * 0.7, area.y + area.height * 0.7, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => quadratic.locator(".js-plotly-plot").evaluate((node) => JSON.stringify((node as PlotlyHTMLElement).layout.xaxis?.range))).not.toBe(initialRange)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await quadratic.getByRole("button", { name: "Expand visualization" }).click()
    const dialog = page.getByRole("dialog", { name: "Quadratic function" })
    await expect(dialog.locator(".js-plotly-plot")).toBeVisible()
    await dialog.getByRole("button", { name: "Close preview" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator(".js-plotly-plot")).toHaveCount(3)
    for (let count = 0; count < 2; count++) {
      await quadratic.getByRole("button", { name: "Expand visualization" }).click()
      await expect(dialog.locator(".js-plotly-plot")).toBeVisible()
      await dialog.getByRole("button", { name: "Close preview" }).click()
      await expect(page.locator(".js-plotly-plot")).toHaveCount(3)
    }
    await expect(plot("Matrix values").locator(".heatmaplayer image")).toBeAttached()
    const spatial = plot("3D surface")
    await spatial.scrollIntoViewIfNeeded()
    await expect(spatial.locator("canvas").first()).toBeVisible()
    await expect(spatial.getByRole("button", { name: "Expand visualization" })).toBeVisible()
    const camera = () => spatial.locator(".js-plotly-plot").evaluate((node) => JSON.stringify((node as PlotlyHTMLElement).layout.scene?.camera ?? null))
    const beforeCamera = await camera()
    const bounds = await spatial.locator("canvas").first().boundingBox()
    if (!bounds) throw new Error("Missing 3D canvas")
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, { steps: 15 })
    await page.mouse.up()
    await expect.poll(camera).not.toBe(beforeCamera)
    await page.screenshot({ path: testInfo.outputPath("plotly-3d.png") })
    await expect(page.getByRole("alert").filter({ hasText: "This visualization could not be rendered" })).toBeVisible()
    await page.setViewportSize({ width: 850, height: 900 })
    await page.getByRole("button", { name: "Open chat", exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    await expect(spatial.locator("canvas").first()).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 940 })
    await page.reload()
    await expect(quadratic.locator(".scatterlayer .trace")).toBeAttached()
    await page.getByRole("navigation", { name: "Your topics" }).getByRole("button", { name: "Plotting", exact: true }).click()
    await expect(page.locator(".study-document").getByRole("figure", { name: longTitle }).locator(".scatterlayer .trace")).toBeAttached()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(externalRequests).toEqual([])
    expect(failures).toEqual([])
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
