import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { Diagnostic } from "../shared/contracts"
import type { createTutorSession } from "./tutor"
import type { TurnTelemetry } from "./telemetry"

export async function startTutorToolServer(session: Awaited<ReturnType<typeof createTutorSession>>, diagnostic: Diagnostic, telemetry?: TurnTelemetry) {
  const token = randomBytes(32).toString("hex")
  const tools = session.tools.map((tool) => {
    if (tool.type !== "function") throw new Error("Unsupported tutoring tool.")
    return ToolSchema.parse({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })
  })
  let sequence = Promise.resolve()
  let calls = 0
  let closed = false
  let failure: Error | undefined
  let context = telemetry?.capture()
  const connections = new Set<Server>()
  const http = createServer((request, response) => {
    if (closed || request.url !== "/mcp" || request.headers.authorization !== `Bearer ${token}` || request.headers.origin) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end()
      return
    }
    void (async () => {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error("Invalid MCP request body.")
        length += chunk.length
        if (length > 1_000_000) {
          response.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      const body = z.json().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      // The session already owns tool schemas and validation; reuse them without rebuilding Zod schemas from JSON.
      const server = new Server({ name: "edu", version: "1.0.0" }, { capabilities: { tools: {} } })
      connections.add(server)
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
      server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
        const operation = sequence.then(async () => {
          if (closed) throw new Error("The tutoring turn has ended.")
          if (++calls > 48) {
            failure = new Error("The runner reached its tutoring tool limit.")
            throw failure
          }
          diagnostic("tool.call", { tool: params.name })
          const input = z.json().parse(params.arguments ?? {})
          let result
          if (telemetry && context) result = await telemetry.within(context, () => session.execute(params.name, input))
          else result = await session.execute(params.name, input)
          const content = [{ type: "text" as const, text: result.text }]
          // Keep the CLI adapters' existing text-only source contract.
          if (result.images.length) {
            failure = new Error("This provider adapter supports text and extracted PDF text. Use ChatGPT for image-based sources.")
            diagnostic("tool.result", { tool: params.name, success: false, error: failure.message })
            return { content: [{ type: "text" as const, text: failure.message }], isError: true }
          }
          diagnostic("tool.result", { tool: params.name, success: result.success, error: result.success ? null : result.text })
          return { content, isError: !result.success }
        })
        // Reads and writes share the queue so a save cannot overtake an earlier tool call.
        sequence = operation.then(() => {}, () => {})
        return operation
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      response.on("close", () => {
        connections.delete(server)
        void server.close().catch(() => {})
      })
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
    })().catch(() => {
      if (!response.headersSent) response.writeHead(400)
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject)
    http.listen(0, "127.0.0.1", resolve)
  })
  const address = http.address()
  if (!address || typeof address === "string") throw new Error("Could not start the tutoring tool server.")
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
    names: tools.map((tool) => tool.name),
    beginAttempt() {
      context = telemetry?.capture()
    },
    async drain() {
      await sequence
      if (failure) throw failure
    },
    async close() {
      if (closed) return
      closed = true
      await sequence
      await Promise.all([...connections].map((server) => server.close()))
      await new Promise<void>((resolve, reject) => {
        http.close((error) => {
          if (error) reject(error)
          else resolve()
        })
        http.closeAllConnections()
      })
    },
  }
}
