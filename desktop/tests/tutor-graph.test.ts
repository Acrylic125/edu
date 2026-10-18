import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat } from "../src/main/workspace"
import { WorkerJobSchema } from "../src/shared/contracts"
import { createTutorSession } from "../src/runners/tutor"
import { createTutorGraph, createTutorToolGraph } from "../src/runners/tutor-graph"

async function session() {
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({
    chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" },
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"),
  })
  return { chat, tutor: await createTutorSession(job, () => {}) }
}

test("the graph executes tools in order, repairs a rejected save, and publishes only the corrected reply", async () => {
  const { chat, tutor } = await session()
  const recovery: string[] = []
  const responses = [
    { reply: "Rejected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify({ ...chat.learning, workpad: "" }) }], finishAfterTools: true },
    { reply: "Corrected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify(chat.learning) }], finishAfterTools: true },
  ]
  const graph = createTutorGraph({
    session: tutor,
    model: async () => {
      const response = responses.shift()
      if (!response) throw new Error("Unexpected model request")
      return response
    },
    consumeTools: () => {},
    recover: (message) => { recovery.push(message) },
    maxAttempts: 3,
    exhausted: () => new Error("Tool limit"),
  })
  const nodes: string[] = []
  let reply = ""
  for await (const update of await graph.stream({}, { streamMode: "updates", recursionLimit: 30 })) {
    nodes.push(...Object.keys(update))
    if (update.publish?.result) reply = update.publish.result.reply
  }
  expect(nodes).toEqual(["model", "tools", "validate", "recover", "model", "tools", "validate", "publish"])
  expect(recovery[0]).toContain("A private handoff and a concrete next action are required")
  expect(reply).toBe("Corrected reply")
})

test("a read batch must be consumed by the next model request before its reply can publish", async () => {
  const { chat, tutor } = await session()
  let count = 0
  const readResults: string[] = []
  const graph = createTutorGraph({
    session: tutor,
    model: async () => {
      count++
      if (count === 1) return { reply: "Premature", calls: [
        { name: "read_skill", arguments: JSON.stringify({ path: "references/FILE_STRUCTURE.md" }) },
        { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
      ], finishAfterTools: true }
      expect(readResults[0]).toContain("Topic files and source attribution")
      return { reply: "Reply after reading", calls: [], finishAfterTools: true }
    },
    consumeTools: (_calls, results) => { readResults.push(...results.map((result) => result.text)) },
    recover: () => {}, maxAttempts: 3, exhausted: () => new Error("Tool limit"),
  })
  expect((await graph.invoke({})).result?.reply).toBe("Reply after reading")
  expect(count).toBe(2)
})

test("the graph stops at its model budget and never publishes an unsaved reply", async () => {
  const { tutor } = await session()
  let requests = 0
  const graph = createTutorGraph({
    session: tutor,
    model: async () => { requests++; return { reply: "Unsaved", calls: [], finishAfterTools: false } },
    consumeTools: () => {}, recover: () => {}, maxAttempts: 3, exhausted: () => new Error("Model budget exhausted"),
  })
  await expect(graph.invoke({}, { recursionLimit: 30 })).rejects.toThrow("Model budget exhausted")
  expect(requests).toBe(3)
})

test("native tool graphs invalidate a previous successful save on malformed arguments", async () => {
  const { chat, tutor } = await session()
  const graph = createTutorToolGraph(tutor)
  const result = await graph.invoke({ calls: [
    { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    { name: "save_learning_state", arguments: "{" },
  ] })
  expect(result.results.map((result) => result.success)).toEqual([true, false])
  expect(tutor.saved).toBe(false)
  expect(() => tutor.finish("Stale reply")).toThrow()
})
