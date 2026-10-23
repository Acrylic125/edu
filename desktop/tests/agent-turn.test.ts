import { expect, test, vi } from "vitest"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { SpanStatusCode } from "@opentelemetry/api"
import { runAgentTurn } from "../src/runners/agent-turn"
import { TurnTelemetry } from "../src/runners/telemetry"

test("a saved runner reply validates and finishes without an extra provider request", async () => {
  const order: string[] = []
  const result = await runAgentTurn({
    limit: 1,
    async run(attempt) { order.push(`agent:${attempt}`) },
    ready: () => { order.push("validate"); return true },
    recover: () => { throw new Error("Unexpected repair") },
    finish: () => { order.push("finish"); return { reply: "A lesson" } },
    exhausted: () => new Error("Limit reached"),
  })
  expect(result).toEqual({ reply: "A lesson" })
  expect(order).toEqual(["agent:1", "validate", "finish"])
})

test("a native runner can repair its handoff on its last allowed attempt", async () => {
  let saved = false
  const recover = vi.fn()
  const run = vi.fn(async (attempt: number) => { saved = attempt === 3 })
  const result = await runAgentTurn({ limit: 3, run, ready: () => saved, recover, finish: () => "done", exhausted: () => new Error("Limit reached") })
  expect(result).toBe("done")
  expect(run.mock.calls).toEqual([[1], [2], [3]])
  expect(recover).toHaveBeenCalledTimes(2)
})

test("an unsaved reply exhausts the request budget without finishing", async () => {
  const run = vi.fn(async () => {})
  const recover = vi.fn()
  const finish = vi.fn()
  await expect(runAgentTurn({
    limit: 3, run, ready: () => false, recover, finish,
    exhausted: () => new Error("No saved handoff after 3 attempts"),
  })).rejects.toThrow("No saved handoff after 3 attempts")
  expect(run).toHaveBeenCalledTimes(3)
  expect(recover).toHaveBeenCalledTimes(2)
  expect(finish).not.toHaveBeenCalled()
})

test("native runner errors propagate without automatic retries", async () => {
  const run = vi.fn(async () => { throw new Error("Provider disconnected") })
  const recover = vi.fn()
  await expect(runAgentTurn({
    limit: 3, run, ready: () => false, recover, finish: () => "invalid",
    exhausted: () => new Error("Limit reached"),
  })).rejects.toThrow("Provider disconnected")
  expect(run).toHaveBeenCalledOnce()
  expect(recover).not.toHaveBeenCalled()
})

test("runner and validation spans retain error status and tool parentage during recovery", async () => {
  const exporter = new InMemorySpanExporter()
  const telemetry = new TurnTelemetry({ directory: "unused", name: "tutor.run", exporter })
  let saved = false
  try {
    await runAgentTurn({
      limit: 2, telemetry, runner: { provider: "codex", model: "fixture" },
      async run() { await telemetry.span("read_material", "TOOL", async () => {}) },
      ready: () => saved, recover: () => { saved = true }, finish: () => "lesson",
      exhausted: () => new Error("Limit reached"),
    })
    const spans = exporter.getFinishedSpans()
    const runner = spans.find((span) => span.name === "runner.codex")!
    const tool = spans.find((span) => span.name === "read_material")!
    expect(tool.parentSpanContext?.spanId).toBe(runner.spanContext().spanId)
    expect(spans.filter((span) => span.name === "turn.validate").map((span) => span.status.code)).toEqual([SpanStatusCode.ERROR, SpanStatusCode.UNSET])
    expect(spans.some((span) => span.name === "turn.recover")).toBe(true)
    expect(spans.some((span) => span.name === "turn.finish")).toBe(true)
  } finally {
    await telemetry.finish()
  }
})
