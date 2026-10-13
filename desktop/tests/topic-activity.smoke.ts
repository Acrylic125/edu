import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron, expect, test } from "@playwright/test"
import { SnapshotSchema } from "../src/shared/contracts"
import { topicMention } from "../src/shared/topic-mentions"
import { newTopic, WorkspaceRepository } from "../src/main/workspace"

test("topic loading follows the current turn instead of earlier chat tags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-activity-"))
  const repository = new WorkspaceRepository(join(directory, "workspace"))
  await repository.load()
  await repository.mutate((state) => state.topics.push(newTopic("Calculus"), newTopic("Automata")))
  const {
    ELECTRON_RENDERER_URL: _rendererUrl,
    ELECTRON_RUN_AS_NODE: _nodeMode,
    ...environment
  } = process.env
  const app = await _electron.launch({
    executablePath: process.env.PRUNE_PACKAGED_APP,
    args: process.env.PRUNE_PACKAGED_APP ? [] : [resolve(".")],
    env: { ...environment, PRUNE_DATA_DIR: directory },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByLabel("Message your tutor")).toBeVisible()
    // Startup provider notifications would replace the synthetic running snapshot below.
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.prune?.snapshot())
      return snapshot?.providers.every((provider) => !provider.loading)
    }).toBe(true)
    const setup = await page.evaluate(async () => {
      const bridge = window.prune
      if (!bridge) throw new Error("Missing desktop bridge")
      const initial = await bridge.snapshot()
      const runnerId = initial.runners[0].id
      const calculus = initial.topics.find((topic) => topic.title === "Calculus")?.id
      const automata = initial.topics.find((topic) => topic.title === "Automata")?.id
      if (!calculus || !automata) throw new Error("Missing seeded topics")
      const chatId = await bridge.createChat({ runnerId })
      return { snapshot: await bridge.snapshot(), runnerId, chatId, calculus, automata }
    })
    const messages = [
      {
        id: randomUUID(),
        role: "user" as const,
        content: `${topicMention(setup.calculus, "Calculus")} Explain limits`,
        createdAt: new Date().toISOString(),
        topicIds: [setup.calculus],
      },
      {
        id: randomUUID(),
        role: "user" as const,
        content: `${topicMention(setup.automata, "Automata")} Explain finite automata`,
        createdAt: new Date().toISOString(),
        topicIds: [setup.automata],
      },
    ]
    const snapshot = SnapshotSchema.parse({
      ...setup.snapshot,
      chats: setup.snapshot.chats.map((chat) => ({ ...chat, messages })),
      runtime: [{ runnerId: setup.runnerId, chatId: setup.chatId, status: "running", activity: "Preparing your lesson" }],
    })
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, snapshot)
    const navigation = page.getByRole("navigation", { name: "Your topics" })
    const automata = navigation.getByRole("button", { name: /^Automata/ })
    const calculus = navigation.getByRole("button", { name: /^Calculus/ })
    await automata.click()
    await expect(automata).toHaveAttribute("aria-current", "page")
    await expect(automata.getByLabel("Runner working")).toHaveCount(1)
    await expect(calculus.getByLabel("Runner working")).toHaveCount(0)

    const continued = SnapshotSchema.parse({
      ...snapshot,
      chats: snapshot.chats.map((chat) => ({
        ...chat,
        messages: [...messages, { id: randomUUID(), role: "user", content: "Continue", createdAt: new Date().toISOString(), topicIds: [] }],
      })),
    })
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, continued)
    await expect(automata.getByLabel("Runner working")).toHaveCount(1)
    await expect(calculus.getByLabel("Runner working")).toHaveCount(0)

    const secondRunner = { ...snapshot.runners[0], id: randomUUID(), name: "Second tutor" }
    const secondChat = { ...snapshot.chats[0], id: randomUUID(), runnerId: secondRunner.id, messages: [messages[0]] }
    const parallel = SnapshotSchema.parse({
      ...snapshot,
      runners: [...snapshot.runners, secondRunner],
      chats: [...snapshot.chats, secondChat],
      runtime: [...snapshot.runtime, { runnerId: secondRunner.id, chatId: secondChat.id, status: "running", activity: "Preparing your lesson" }],
    })
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, parallel)
    await expect(automata.getByLabel("Runner working")).toHaveCount(1)
    await expect(calculus.getByLabel("Runner working")).toHaveCount(1)

    const comparing = SnapshotSchema.parse({
      ...snapshot,
      chats: snapshot.chats.map((chat) => ({
        ...chat,
        messages: [...messages, { id: randomUUID(), role: "user", content: "Compare these topics", createdAt: new Date().toISOString(), topicIds: [setup.calculus, setup.automata] }],
      })),
    })
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, comparing)
    await expect(automata.getByLabel("Runner working")).toHaveCount(1)
    await expect(calculus.getByLabel("Runner working")).toHaveCount(1)

    await app.evaluate(({ BrowserWindow }, snapshot) => {
      BrowserWindow.getAllWindows()[0].webContents.send("prune:update", snapshot)
    }, { ...snapshot, runtime: [] })
    await expect(page.getByLabel("Runner working")).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
