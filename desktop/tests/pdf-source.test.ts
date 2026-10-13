import { randomUUID } from "node:crypto"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test, vi } from "vitest"
import { newChat } from "../src/main/workspace"

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
      runner, chat, topics: [], apiKey: "", assetDirectory: directory, skillDirectory: resolve("resources/tutor-me"),
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
