import { afterEach, expect, test, vi } from "vitest"
import { runAgentGraph } from "../src/runners/graph"

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test("inherited LangSmith settings cannot enable automatic trace uploads", async () => {
  vi.stubEnv("LANGSMITH_TRACING", "true")
  vi.stubEnv("LANGCHAIN_TRACING_V2", "true")
  vi.stubEnv("LANGCHAIN_TRACING", "true")
  vi.stubEnv("LANGSMITH_API_KEY", "synthetic-only")
  const fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetch)
  await runAgentGraph({
    limit: 1, run: async () => "validate", ready: () => true,
    recover: () => {}, finish: () => "lesson", exhausted: () => new Error("Limit reached"),
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(fetch).not.toHaveBeenCalled()
})

test("LangGraph orchestrates runner/tool cycles and validates before finishing", async () => {
  const order: string[] = []
  const result = await runAgentGraph({
    limit: 3,
    async run(iteration) {
      order.push(`agent:${iteration}`)
      if (iteration === 1) return "tools"
      return "validate"
    },
    async tools() { order.push("tools"); return "agent" },
    ready: () => { order.push("validate"); return true },
    recover: () => { throw new Error("Unexpected repair") },
    finish: () => { order.push("finish"); return { reply: "A lesson" } },
    exhausted: () => new Error("Limit reached"),
  })
  expect(result).toEqual({ reply: "A lesson" })
  expect(order).toEqual(["agent:1", "tools", "agent:2", "validate", "finish"])
})

test("a native runner can repair its handoff without invoking an EdU tool batch", async () => {
  let saved = false
  const recover = vi.fn(() => { saved = true })
  const run = vi.fn(async () => "validate" as const)
  await runAgentGraph({ limit: 3, run, ready: () => saved, recover, finish: () => "done", exhausted: () => new Error("Limit reached") })
  expect(run).toHaveBeenCalledTimes(2)
  expect(recover).toHaveBeenCalledOnce()
})

test("CLI save batches may validate and finish without an extra runner request", async () => {
  const run = vi.fn(async () => "tools" as const)
  const result = await runAgentGraph({
    limit: 1, run, tools: async () => "validate", ready: () => true,
    recover: () => {}, finish: () => "saved", exhausted: () => new Error("Limit reached"),
  })
  expect(result).toBe("saved")
  expect(run).toHaveBeenCalledOnce()
})

test("the graph enforces the adapter's request budget", async () => {
  const run = vi.fn(async () => "validate" as const)
  const finish = vi.fn()
  await expect(runAgentGraph({
    limit: 3, run, ready: () => false, recover: () => {}, finish,
    exhausted: () => new Error("No saved handoff after 3 attempts"),
  })).rejects.toThrow("No saved handoff after 3 attempts")
  expect(run).toHaveBeenCalledTimes(3)
  expect(finish).not.toHaveBeenCalled()
})

test("native runner errors propagate without automatic retries", async () => {
  const run = vi.fn(async () => { throw new Error("Provider disconnected") })
  await expect(runAgentGraph({
    limit: 3, run, ready: () => false, recover: () => {}, finish: () => "invalid",
    exhausted: () => new Error("Limit reached"),
  })).rejects.toThrow("Provider disconnected")
  expect(run).toHaveBeenCalledOnce()
})
