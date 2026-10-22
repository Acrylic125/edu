import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { afterEach, expect, test, vi } from "vitest"
import { newChat } from "../src/main/workspace"
import { WorkerJobSchema } from "../src/shared/contracts"
import { createTutorSession } from "../src/runners/tutor"
import { startTutorToolServer } from "../src/runners/tutor-mcp"
import { TurnTelemetry } from "../src/runners/telemetry"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "edu-tutor-mcp-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider: "claude", model: "fixture" }, skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory })
  const session = await createTutorSession(job, () => {})
  const diagnostic = vi.fn()
  const server = await startTutorToolServer(session, diagnostic)
  cleanup.push(() => server.close())
  const client = new Client({ name: "native-agent-test", version: "1" })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }))
  cleanup.push(() => client.close())
  return { directory, chat, job, session, diagnostic, server, client }
}

test("discovers the existing tutor tools and saves through the shared session", async () => {
  const { session, chat, server, client } = await setup()
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name)).toEqual(session.tools.map((tool) => {
    if (tool.type !== "function") throw new Error("Expected function tool")
    return tool.function.name
  }))
  const result = await client.callTool({ name: "save_learning_state", arguments: chat.learning })
  await server.drain()
  expect(result.isError).toBe(false)
  expect(session.saved).toBe(true)
})

test("rejects unauthenticated, cross-origin, and cross-turn requests", async () => {
  const first = await setup()
  const second = await setup()
  expect((await fetch(first.server.url, { method: "POST" })).status).toBe(403)
  expect((await fetch(first.server.url, { method: "POST", headers: second.server.headers })).status).toBe(403)
  expect((await fetch(first.server.url, { method: "POST", headers: { ...first.server.headers, Origin: "https://example.test" } })).status).toBe(403)
  expect((await fetch(first.server.url, { headers: first.server.headers })).status).toBe(405)
})

test("limits request bodies and closes the endpoint after the turn", async () => {
  const { server } = await setup()
  const response = await fetch(server.url, { method: "POST", headers: server.headers, body: "x".repeat(1_000_001) })
  expect(response.status).toBe(413)
  await server.close()
  await expect(fetch(server.url)).rejects.toThrow()
})

test("a rejected save invalidates a previous handoff until the native agent repairs it", async () => {
  const { server, session, client, chat } = await setup()
  await client.callTool({ name: "save_learning_state", arguments: chat.learning })
  const rejected = await client.callTool({ name: "save_learning_state", arguments: { ...chat.learning, workpad: "" } })
  await server.drain()
  expect(rejected.isError).toBe(true)
  expect(session.saved).toBe(false)
  const repaired = await client.callTool({ name: "save_learning_state", arguments: chat.learning })
  expect(repaired.isError).toBe(false)
  expect(session.saved).toBe(true)
})

test("serializes tool execution even when a native client issues concurrent calls", async () => {
  const { client, diagnostic } = await setup()
  await Promise.all([
    client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_TOPIC.md" } }),
    client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_GENERIC.md" } }),
  ])
  expect(diagnostic.mock.calls.map(([event]) => event)).toEqual(["tool.call", "tool.result", "tool.call", "tool.result"])
})

test("a native agent cannot exceed the shared tool-call budget and publish an older save", async () => {
  const { client, server, chat } = await setup()
  await client.callTool({ name: "save_learning_state", arguments: chat.learning })
  for (let call = 1; call < 48; call++) await client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_GENERIC.md" } })
  await expect(client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_GENERIC.md" } })).rejects.toThrow("tool limit")
  await expect(server.drain()).rejects.toThrow("tool limit")
})

test("native MCP tool spans retain the active agent span as their parent", async () => {
  const { directory, job } = await setup()
  const exporter = new InMemorySpanExporter()
  const telemetry = new TurnTelemetry({ directory, name: "turn", exporter })
  const session = await createTutorSession(job, () => {}, telemetry)
  const server = await startTutorToolServer(session, () => {}, telemetry)
  cleanup.push(() => telemetry.finish())
  cleanup.push(() => server.close())
  const client = new Client({ name: "trace-test", version: "1" })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }))
  cleanup.push(() => client.close())
  await telemetry.span("runner.claude", "AGENT", async () => {
    server.beginAttempt()
    await client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_TOPIC.md" } })
  })
  const spans = exporter.getFinishedSpans()
  const agent = spans.find((span) => span.name === "runner.claude")
  const tool = spans.find((span) => span.name === "read_skill")
  expect(agent).toBeDefined()
  expect(tool?.parentSpanContext?.spanId).toBe(agent?.spanContext().spanId)
})
