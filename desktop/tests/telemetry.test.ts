import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test } from "vitest"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer"
import { SpanStatusCode } from "@opentelemetry/api"
import { FileSpanExporter, installPhoenixExporter, TurnTelemetry } from "../src/runners/telemetry"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "edu-otel-"))
  directories.push(path)
  return path
}

test("worker spans share the main-process trace and keep concurrent contexts separate", async () => {
  const exporter = new InMemorySpanExporter()
  const root = new TurnTelemetry({ directory: await directory(), name: "tutor.turn", exporter })
  const childExporter = new InMemorySpanExporter()
  const worker = new TurnTelemetry({ directory: await directory(), name: "tutor.graph", parent: root.context, exporter: childExporter })
  await Promise.all(["codex", "claude"].map((runner) => worker.span(runner, "AGENT", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    await worker.span(`${runner}.tool`, "TOOL", async () => {})
  })))
  // Inspect before shutdown because the SDK's memory exporter clears itself on shutdown.
  const spans = childExporter.getFinishedSpans()
  for (const runner of ["codex", "claude"]) {
    const agent = spans.find((span) => span.name === runner)!
    const tool = spans.find((span) => span.name === `${runner}.tool`)!
    expect(agent.spanContext().traceId).toBe(root.context.traceId)
    expect(tool.parentSpanContext?.spanId).toBe(agent.spanContext().spanId)
  }
  expect(worker.context.traceId).toBe(root.context.traceId)
  await worker.finish()
  await root.finish()
})

test("file export produces atomic OTLP protobuf requests with private file permissions", async () => {
  const path = await directory()
  const memory = new InMemorySpanExporter()
  const telemetry = new TurnTelemetry({ directory: path, name: "test", exporter: memory })
  await telemetry.span("agent", "AGENT", async () => {})
  const spans = memory.getFinishedSpans()
  const exporter = new FileSpanExporter(path)
  await new Promise<void>((resolve, reject) => exporter.export(spans, (result) => {
    if (result.error) reject(result.error)
    else resolve()
  }))
  await exporter.shutdown()
  const files = await readdir(path)
  expect(files).toHaveLength(1)
  expect(files[0]).toMatch(/\.otlp$/)
  expect(await readFile(join(path, files[0]))).toEqual(Buffer.from(ProtobufTraceSerializer.serializeRequest(spans)!))
  expect((await stat(join(path, files[0]))).mode & 0o777).toBe(0o600)
  await telemetry.finish()
})

test("failed spans record status without leaking exception messages or arguments", async () => {
  const memory = new InMemorySpanExporter()
  const telemetry = new TurnTelemetry({ directory: await directory(), name: "test", exporter: memory })
  await expect(telemetry.span("read_material", "TOOL", async () => {
    throw new Error("private answer sk-secret")
  })).rejects.toThrow("private answer")
  const spans = memory.getFinishedSpans()
  expect(spans[0].status.code).toBe(SpanStatusCode.ERROR)
  expect(JSON.stringify(spans.map(({ attributes, events, status }) => ({ attributes, events, status })))).not.toContain("sk-secret")
  await telemetry.finish(true)
})

test("file export failures are observable at flush", async () => {
  const path = join(await directory(), "not-a-directory")
  await writeFile(path, "file")
  const telemetry = new TurnTelemetry({ directory: path, name: "test" })
  await expect(telemetry.finish()).rejects.toThrow("trace")
})

test("installs the exporter into a relocated runtime workspace", async () => {
  const root = await directory()
  const resources = join(root, "install", "phoenix")
  const workspace = join(root, "user data", "workspace")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(resources, { recursive: true })
  for (const name of ["export_traces.py", "export_traces.py.lock", "README.md"])
    await writeFile(join(resources, name), name)
  await installPhoenixExporter(resources, workspace)
  expect(await readFile(join(workspace, "phoenix", "export_traces.py"), "utf8")).toBe("export_traces.py")
})

test("optional exporter copy failures do not prevent the workspace from opening", async () => {
  const root = await directory()
  expect(await installPhoenixExporter(join(root, "missing-resources"), root)).toBe(false)
})
