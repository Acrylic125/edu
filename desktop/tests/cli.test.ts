import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test, vi } from "vitest"
import { CliToolServerSchema, cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../src/providers/cli"
import { runCliTutorTurn } from "../src/runners/cli"
import { newChat, newTopic } from "../src/main/workspace"
import { randomUUID } from "node:crypto"
import { WorkerJobSchema } from "../src/shared/contracts"
import { generateTopicTitle } from "../src/runners/title"
import * as cliTools from "../src/providers/cli"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import { TopicStateSchema } from "../src/shared/topic-state"

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function connection(provider: "claude" | "antigravity") {
  const directory = await mkdtemp(join(tmpdir(), "edu-cli-test-"))
  directories.push(directory)
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  await chmod(executable, 0o755)
  return { provider, executable, directory }
}

test.each(["claude", "antigravity"] as const)("%s generates a validated title from a suggested topic", async (provider) => {
  const cli = await connection(provider)
  const runner = WorkerJobSchema.shape.runner.parse({ id: randomUUID(), name: "Tutor", provider, model: "default" })
  const processChanged = vi.fn()
  const title = await generateTopicTitle({ cli, runner }, "Teach me limits", processChanged, () => {})
  expect(title).toBe("Introduction to Limits")
  expect(processChanged).toHaveBeenLastCalledWith(null)
})

test.each(["claude", "antigravity"] as const)("%s completes tutoring with source tools and rejects an invalid save before committing", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  chat.messages.push({ id: randomUUID(), role: "user", content: "Teach me limits", createdAt: new Date().toISOString(), topicIds: [] })
  const job = WorkerJobSchema.parse({
    chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const diagnostic = vi.fn()
  const processChanged = vi.fn()
  const result = await runCliTutorTurn(job, () => {}, processChanged, diagnostic)
  expect(result.reply).toContain("Confirm it")
  expect(result.learning.phase).toBe("awaiting_plan_confirmation")
  expect(result.learning.outline).toEqual(["Limits"])
  expect(diagnostic).toHaveBeenCalledWith("tool.result", expect.objectContaining({ tool: "save_learning_state", success: false, error: expect.stringContaining("private handoff") }))
  expect(diagnostic).toHaveBeenCalledWith("tool.result", { tool: "save_learning_state", success: true, error: null })
  expect(processChanged).toHaveBeenLastCalledWith(null)
})

test("CLI processes omit inherited provider API keys", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "secret-test-key")
  vi.stubEnv("GEMINI_API_KEY", "secret-test-key")
  const cli = await connection("claude")
  expect(JSON.parse(await runCliCommand(cli, ["inspect-environment"]))).toEqual({ key: null, gemini: null, grants: null })
})

test("CLI launch disables native tools and does not bypass permissions", async () => {
  const claude = await connection("claude")
  const args = cliPromptArguments(claude, "{}")
  expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""])
  expect(args).toContain("--safe-mode")
  const antigravity = await connection("antigravity")
  await prepareCliWorkspace(antigravity)
  expect(await readFile(join(antigravity.directory, ".agents/agents/edu-tutor.md"), "utf8")).toContain("tools: [finish]")
  expect(await readFile(join(antigravity.directory, ".agents/agents/edu-tutor.md"), "utf8")).not.toContain("Save the private handoff")
  expect(cliPromptArguments(antigravity, "{}")).toContain("--sandbox")
  expect(cliPromptArguments(antigravity, "{}")).not.toContain("--dangerously-skip-permissions")
})

test("tutoring CLI launches expose only native web research tools", async () => {
  const claude = await connection("claude")
  const args = cliPromptArguments(claude, "{}", "default", undefined, true)
  expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch")
  expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch")
  expect(args).toContain("--safe-mode")
  const antigravity = await connection("antigravity")
  await prepareCliWorkspace(antigravity, true)
  const agent = await readFile(join(antigravity.directory, ".agents/agents/edu-tutor.md"), "utf8")
  expect(agent).toContain("tools: [finish, search_web, read_url_content]")
  expect(agent).toContain("commandExecutionPolicy: off")
})

test("Antigravity grants apply only to the current EdU tools without inheriting broader grants", async () => {
  vi.stubEnv("ANTIGRAVITY_PERM_GRANTS", JSON.stringify({ allow: ["command(*)", "mcp(*)"] }))
  const cli = await connection("antigravity")
  const tools = { url: "http://127.0.0.1:12345/mcp", headers: { Authorization: "Bearer fixture" }, names: ["read_skill", "save_learning_state"] }
  const result = z.object({ grants: z.string() }).parse(JSON.parse(await runCliCommand(cli, ["inspect-environment"], "", undefined, undefined, undefined, tools)))
  expect(JSON.parse(result.grants)).toEqual({ allow: ["mcp(edu/read_skill)", "mcp(edu/save_learning_state)"], deny: [], ask: [] })
  const args = cliPromptArguments(cli, "{}", "default", undefined, true, tools)
  expect(args[args.indexOf("--print-timeout") + 1]).toBe("5m")
})

test("CLI errors and malformed results cannot masquerade as successful tutoring", () => {
  expect(() => parseCliResponse("claude", '{"is_error":true}')).toThrow("could not complete")
  expect(() => parseCliResponse("antigravity", '{"status":"WAITING"}')).toThrow("could not complete")
  expect(() => parseCliResponse("claude", "invalid-json")).toThrow()
})

test("canceling a provider request terminates its native subprocess", async () => {
  const cli = await connection("claude")
  const controller = new AbortController()
  const processChanged = vi.fn()
  const result = runCliCommand(cli, ["auth", "status"], "", processChanged, 15_000, controller.signal)
  const pid = processChanged.mock.calls[0][0]
  controller.abort()
  await expect(result).rejects.toThrow("canceled")
  expect(processChanged).toHaveBeenLastCalledWith(null)
  expect(() => process.kill(pid, 0)).toThrow()
})

async function nativeClient(cli: Awaited<ReturnType<typeof connection>>, args: string[]) {
  const EndpointSchema = CliToolServerSchema.omit({ names: true })
  let endpoint
  if (cli.provider === "claude") {
    const config = z.object({ mcpServers: z.object({ edu: EndpointSchema }) }).parse(JSON.parse(args[args.indexOf("--mcp-config") + 1]))
    endpoint = config.mcpServers.edu
  } else {
    const agent = await readFile(join(cli.directory, ".agents/agents/edu-tutor.md"), "utf8")
    const line = /^mcpServers: (.+)$/m.exec(agent)?.[1]
    if (!line) throw new Error("Missing native EdU server")
    const [server] = z.array(EndpointSchema.omit({ url: true }).extend({ name: z.literal("edu"), serverUrl: z.url() })).parse(JSON.parse(line))
    endpoint = { url: server.serverUrl, headers: server.headers }
  }
  const client = new Client({ name: "native-provider-test", version: "1.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }))
  return { client, endpoint }
}

test("native Claude tutoring loads only EdU MCP tools without safe-mode disabling them", async () => {
  const cli = await connection("claude")
  const endpoint = { url: "http://127.0.0.1:12345/mcp", headers: { Authorization: "Bearer fixture" }, names: ["read_skill", "save_learning_state"] }
  const args = cliPromptArguments(cli, "{}", "default", undefined, true, endpoint)
  expect(args).toContain("--bare")
  expect(args).not.toContain("--safe-mode")
  expect(args).toContain("--strict-mcp-config")
  expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch")
  expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch,mcp__edu__read_skill,mcp__edu__save_learning_state")
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1])
  expect(config).toEqual({ mcpServers: { edu: { type: "http", url: endpoint.url, headers: endpoint.headers } } })
})

test.each(["claude", "antigravity"] as const)("%s uses native tool callbacks and the same validated turn loop as Codex", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  let endpoint = ""
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async (connection, args) => {
    const native = await nativeClient(connection, args)
    endpoint = native.endpoint.url
    try {
      const list = await native.client.listTools()
      expect(list.tools.some((tool) => tool.name === "save_learning_state")).toBe(true)
      const source = await native.client.callTool({ name: "read_skill", arguments: { path: "skills/MANAGE_TOPIC.md" } })
      expect(source.isError).toBe(false)
      const saved = await native.client.callTool({ name: "save_learning_state", arguments: chat.learning })
      expect(saved.isError).toBe(false)
      return JSON.stringify({ status: "SUCCESS", structured_output: { reply: "A lesson using the native tool results." } })
    } finally { await native.client.close() }
  })
  const nodes: string[] = []
  const result = await runCliTutorTurn(job, () => {}, () => {}, (event, details) => {
    if (event === "turn.step" && typeof details.step === "string") nodes.push(details.step)
  })
  expect(result.reply).toContain("native tool results")
  expect(result.learning).toEqual(chat.learning)
  expect(command).toHaveBeenCalledOnce()
  expect(nodes).toEqual(["agent", "validate", "finish"])
  await expect(fetch(endpoint)).rejects.toThrow()
})

test.each(["claude", "antigravity"] as const)("%s stages content through native tools and presents the stored lesson", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const topic = newTopic("Limits")
  topic.planConfirmed = true
  const job = WorkerJobSchema.parse({ chat, topics: [{ ...topic, assetDirectory: cli.directory }], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  vi.spyOn(cliTools, "runCliCommand").mockImplementation(async (connection, args) => {
    const { client } = await nativeClient(connection, args)
    try {
      await client.callTool({ name: "read_scratchpad", arguments: { scratchpadId: "scratchpad_1" } })
      const edited = await client.callTool({ name: "topic_editContent", arguments: { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "limit-example", content: ["A limit describes nearby behavior."] } }], present: ["limit-example"] } })
      expect(edited.isError).toBe(false)
      await client.callTool({ name: "save_learning_state", arguments: chat.learning })
      return JSON.stringify({ status: "SUCCESS", structured_output: { reply: "A different generated explanation." } })
    } finally { await client.close() }
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe("A limit describes nearby behavior.")
  expect(result.topicMutations).toMatchObject([{ type: "editTopicContent", topicId: topic.id }])
})

test.each(["claude", "antigravity"] as const)("%s repairs a rejected save inside one native turn", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async (connection, args) => {
    const { client } = await nativeClient(connection, args)
    try {
      const rejected = await client.callTool({ name: "save_learning_state", arguments: { ...chat.learning, workpad: "" } })
      expect(rejected.isError).toBe(true)
      const repaired = await client.callTool({ name: "save_learning_state", arguments: chat.learning })
      expect(repaired.isError).toBe(false)
      return JSON.stringify({ status: "SUCCESS", structured_output: { reply: "Corrected lesson." } })
    } finally { await client.close() }
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe("Corrected lesson.")
  expect(command).toHaveBeenCalledOnce()
})

test.each(["claude", "antigravity"] as const)("%s recovers an incomplete native turn before publishing", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  let attempts = 0
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async (connection, args, input) => {
    attempts++
    const { client } = await nativeClient(connection, args)
    try {
      let workpad = ""
      if (attempts > 1) {
        expect(input).toContain("Internal app correction")
        workpad = chat.learning.workpad
      }
      await client.callTool({ name: "save_learning_state", arguments: { ...chat.learning, workpad } })
      return JSON.stringify({ status: "SUCCESS", structured_output: { reply: `Attempt ${attempts}` } })
    } finally { await client.close() }
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe("Attempt 2")
  expect(command).toHaveBeenCalledTimes(2)
})

test.each(["claude", "antigravity"] as const)("%s reads cross-topic evidence within one native turn", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const topic = newTopic("Archived physics")
  const evidence = "Learner confused speed with acceleration; later resolved."
  const state = TopicStateSchema.parse(topic.state)
  state.document = { version: 1, blocks: [{ type: "markdown", id: "physics-evidence", content: [evidence] }] }
  const job = WorkerJobSchema.parse({ chat, topics: [], workspaceTopics: [{ id: topic.id, title: topic.title, archived: true, notes: evidence, state }], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async (connection, args) => {
    const { client } = await nativeClient(connection, args)
    try {
      const read = await client.callTool({ name: "read_scratchpad", arguments: { scratchpadId: "scratchpad_1" } })
      expect(JSON.stringify(read)).toContain(evidence)
      await client.callTool({ name: "save_learning_state", arguments: chat.learning })
      return JSON.stringify({ status: "SUCCESS", structured_output: { reply: evidence } })
    } finally { await client.close() }
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe(evidence)
  expect(command).toHaveBeenCalledOnce()
})

test.each(["claude", "antigravity"] as const)("%s stops after three incomplete native turns", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({ chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli, skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory })
  const command = vi.spyOn(cliTools, "runCliCommand").mockResolvedValue(JSON.stringify({ status: "SUCCESS", structured_output: { reply: "An unsaved response." } }))
  await expect(runCliTutorTurn(job, () => {}, () => {})).rejects.toMatchObject({ detail: expect.stringContaining("3 attempts") })
  expect(command).toHaveBeenCalledTimes(3)
})

test("Antigravity title generation allows the full CLI startup deadline", async () => {
  const cli = await connection("antigravity")
  const runner = WorkerJobSchema.shape.runner.parse({ id: randomUUID(), name: "Tutor", provider: "antigravity", model: "default" })
  const command = vi.spyOn(cliTools, "runCliCommand").mockResolvedValue(JSON.stringify({ status: "SUCCESS", structured_output: { title: "Introduction to Limits" } }))
  await expect(generateTopicTitle({ cli, runner }, "Teach me limits", () => {}, () => {})).resolves.toBe("Introduction to Limits")
  expect(command.mock.calls[0][4]).toBe(120_000)
})
