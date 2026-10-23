import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat } from "../src/main/workspace"
import { WorkerJobSchema } from "../src/shared/contracts"
import { createTutorSession } from "../src/runners/tutor"
import { runTutorLoop, executeTutorTools } from "../src/runners/tutor-loop"

async function session() {
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({
    chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" },
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"),
  })
  return { chat, tutor: await createTutorSession(job, () => {}) }
}

test("the tutor loop repairs a rejected save and publishes only the corrected reply", async () => {
  const { chat, tutor } = await session()
  const recovery: string[] = []
  const responses = [
    { reply: "Rejected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify({ ...chat.learning, workpad: "" }) }], finishAfterTools: true },
    { reply: "Corrected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify(chat.learning) }], finishAfterTools: true },
  ]
  const steps: string[] = []
  const result = await runTutorLoop({
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
    diagnostic: (event, details) => {
      if (event === "turn.step" && typeof details.step === "string") steps.push(details.step)
    },
  })
  expect(steps).toEqual(["model", "execute_tools", "validate", "recover", "model", "execute_tools", "validate", "publish"])
  expect(recovery[0]).toContain("A private handoff and a concrete next action are required")
  expect(result.reply).toBe("Corrected reply")
})

test("a read batch must be consumed by the next model request before its reply can publish", async () => {
  const { chat, tutor } = await session()
  let count = 0
  const readResults: string[] = []
  const result = await runTutorLoop({
    session: tutor,
    model: async () => {
      count++
      if (count === 1) return { reply: "Premature", calls: [
        { name: "read_skill", arguments: JSON.stringify({ path: "skills/MANAGE_TOPIC.md" }) },
        { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
      ], finishAfterTools: true }
      expect(readResults[0]).toContain("# Manage Topic")
      return { reply: "Reply after reading", calls: [], finishAfterTools: true }
    },
    consumeTools: (_calls, results) => { readResults.push(...results.map((result) => result.text)) },
    recover: () => {}, maxAttempts: 3, exhausted: () => new Error("Tool limit"),
  })
  expect(result.reply).toBe("Reply after reading")
  expect(count).toBe(2)
})

test("the tutor loop stops at its model budget and never publishes an unsaved reply", async () => {
  const { tutor } = await session()
  let requests = 0
  await expect(runTutorLoop({
    session: tutor,
    model: async () => { requests++; return { reply: "Unsaved", calls: [], finishAfterTools: false } },
    consumeTools: () => {}, recover: () => {}, maxAttempts: 3, exhausted: () => new Error("Model budget exhausted"),
  })).rejects.toThrow("Model budget exhausted")
  expect(requests).toBe(3)
})

test("tool batches invalidate a previous successful save on malformed arguments", async () => {
  const { chat, tutor } = await session()
  const results = await executeTutorTools(tutor, [
    { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    { name: "save_learning_state", arguments: "{" },
  ])
  expect(results.map((result) => result.success)).toEqual([true, false])
  expect(tutor.saved).toBe(false)
  expect(() => tutor.finish("Stale reply")).toThrow()
})

test("exhausted validation exposes a retry message while retaining internal diagnostic detail", async () => {
  const { chat, tutor } = await session()
  await expect(runTutorLoop({
    session: tutor,
    model: async () => ({ reply: "Invalid reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify({ ...chat.learning, workpad: "" }) }], finishAfterTools: true }),
    consumeTools: () => {}, recover: () => {}, maxAttempts: 1, exhausted: () => new Error("Model budget"),
  })).rejects.toMatchObject({
    message: "The response could not be prepared. Please retry your message.",
    detail: expect.stringContaining("A private handoff and a concrete next action are required"),
  })
})
