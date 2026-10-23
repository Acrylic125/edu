import { execFile } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { z } from "zod"
import { runAgentTurn } from "../src/runners/agent-turn"
import { TurnTelemetry } from "../src/runners/telemetry"

const environment = z.object({ EDU_PHOENIX_TEST_URL: z.string().url().optional() }).parse(process.env)

test.skipIf(!environment.EDU_PHOENIX_TEST_URL)("replays synthetic tutor OTLP into local Phoenix", async () => {
  const endpoint = environment.EDU_PHOENIX_TEST_URL
  if (!endpoint) throw new Error("Phoenix test URL is required")
  const directory = await mkdtemp(join(tmpdir(), "edu-phoenix-smoke-"))
  try {
    const name = `synthetic-${randomUUID()}`
    const main = new TurnTelemetry({ directory, name })
    const worker = new TurnTelemetry({ directory, name: "tutor.run", parent: main.context })
    let attempt = 0
    await runAgentTurn({
      limit: 3, telemetry: worker, runner: { provider: "codex", model: "synthetic" },
      async run() { attempt++; await worker.span("read_material", "TOOL", async () => {}) },
      ready: () => attempt === 2, recover: () => {}, finish: () => "synthetic lesson",
      exhausted: () => new Error("Synthetic request limit"),
    })
    await worker.finish()
    await main.span("harness.commit", "CHAIN", async () => {})
    await main.finish()
    const failed = new TurnTelemetry({ directory, name: "synthetic.failure" })
    await expect(failed.span("runner.claude", "AGENT", async () => { throw new Error("synthetic") })).rejects.toThrow("synthetic")
    await failed.finish(true)

    const count = (await readdir(directory)).filter((file) => file.endsWith(".otlp")).length
    const args = ["run", resolve("../phoenix/export_traces.py"), "--source", directory, "--endpoint", endpoint]
    const first = await promisify(execFile)("uv", args)
    expect(first.stdout).toContain(`Exported ${count} OTLP files`)
    const second = await promisify(execFile)("uv", args)
    expect(second.stdout).toContain(`skipped ${count} previously exported files`)
    await expect.poll(async () => {
      const response = await fetch(`${endpoint}/v1/projects/EdU/spans?limit=1000`)
      if (!response.ok) return []
      return z.object({ data: z.array(z.object({ name: z.string() })) }).parse(await response.json()).data.map((span) => span.name)
    }, { timeout: 10_000 }).toContain(name)
    const response = await fetch(`${endpoint}/v1/projects/EdU/spans?limit=1000`)
    const spans = z.object({ data: z.array(z.object({ name: z.string(), status_code: z.string() })) }).parse(await response.json()).data
    expect(spans.some((span) => span.name === "synthetic.failure" && span.status_code === "ERROR")).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
