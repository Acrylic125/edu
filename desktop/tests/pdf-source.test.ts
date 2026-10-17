import { randomUUID } from "node:crypto"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test, vi } from "vitest"
import { newChat } from "../src/main/workspace"

// Electron's CommonJS main/worker build loads this entry; its defaults differ from ESM.
vi.mock("unpdf", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("unpdf") as typeof import("unpdf")
})

test("renders PDF source images in an Electron utility process without a DOM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-pdf-source-"))
  const id = randomUUID()
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex" as const, model: "default" }
  const chat = newChat(runner.id)
  chat.materials.push({ id, name: "diagram.pdf", kind: "pdf", text: "Limits diagram", pages: ["Limits diagram"] })
  await copyFile(resolve("tests/fixtures/diagram.pdf"), join(directory, "diagram.pdf"))
  // PDF.js treats Electron utility processes as browsers, even though they have no document.
  Object.defineProperty(process.versions, "electron", { value: "44.7.0", configurable: true })
  Object.defineProperty(process, "type", { value: "utility", configurable: true })
  vi.resetModules()
  try {
    const { createTutorSession } = await import("../src/runners/tutor")
    const session = await createTutorSession({
      runner, chat, topics: [], workspaceTopics: [], apiKey: "", assetDirectory: directory, skillDirectory: resolve("resources/tutor-me"),
    }, () => {})
    const result = await session.execute("read_material", { id, firstPage: 1, lastPage: 1, includeVisuals: true })
    expect(result.text).not.toContain("Tool error:")
    expect(result.success).toBe(true)
    expect(result.images).toHaveLength(2)
    expect((await readFile(join(directory, `source-${id}-1.png`))).subarray(1, 4).toString()).toBe("PNG")
  } finally {
    Reflect.deleteProperty(process.versions, "electron")
    Reflect.deleteProperty(process, "type")
    vi.resetModules()
    await rm(directory, { recursive: true, force: true })
  }
})


test.each([false, true])("Electron renders embedded glyphs correctly with a legacy cache: %s", async (legacyCache) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-pdf-glyphs-"))
  const id = randomUUID()
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex" as const, model: "default" }
  const chat = newChat(runner.id)
  chat.materials.push({ id, name: "embedded-font.pdf", kind: "pdf", text: "MIPS Instruction Execution", pages: ["MIPS Instruction Execution"] })
  await copyFile(resolve("tests/fixtures/embedded-font.pdf"), join(directory, "embedded-font.pdf"))
  if (legacyCache) {
    const { createCanvas } = await import("@napi-rs/canvas")
    await writeFile(join(directory, `source-${id}-1.png`), createCanvas(468, 208).toBuffer("image/png"))
  }
  Object.defineProperty(process.versions, "electron", { value: "44.7.0", configurable: true })
  Object.defineProperty(process, "type", { value: "utility", configurable: true })
  vi.resetModules()
  try {
    const { createTutorSession } = await import("../src/runners/tutor")
    const session = await createTutorSession({
      runner, chat, topics: [], workspaceTopics: [], apiKey: "", assetDirectory: directory, skillDirectory: resolve("resources/tutor-me"),
    }, () => {})
    const result = await session.execute("read_material", { id, firstPage: 1, lastPage: 1, includeVisuals: true })
    expect(result.success).toBe(true)
    const { createIsomorphicCanvasFactory, getDocumentProxy, renderPageAsImage } = await import("unpdf")
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(join(directory, "embedded-font.pdf"))), {
      CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")),
      disableFontFace: true,
    })
    const expected = Buffer.from(await renderPageAsImage(pdf, 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.3 }))
    await pdf.loadingTask.destroy()
    expect((await readFile(join(directory, `source-${id}-1.png`))).equals(expected)).toBe(true)
  } finally {
    Reflect.deleteProperty(process.versions, "electron")
    Reflect.deleteProperty(process, "type")
    vi.resetModules()
    await rm(directory, { recursive: true, force: true })
  }
})
