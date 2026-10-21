import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test, vi } from "vitest"
import { cliPromptArguments, parseCliResponse, prepareCliWorkspace, runCliCommand } from "../src/providers/cli"
import { runCliTutorTurn } from "../src/runners/cli"
import { newChat, newTopic } from "../src/main/workspace"
import { randomUUID } from "node:crypto"
import { WorkerJobSchema } from "../src/shared/contracts"
import { generateTopicTitle } from "../src/runners/title"
import * as cliTools from "../src/providers/cli"

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
  expect(JSON.parse(await runCliCommand(cli, ["inspect-environment"]))).toEqual({ key: null, gemini: null })
})

test("CLI launch disables native tools and does not bypass permissions", async () => {
  const claude = await connection("claude")
  const args = cliPromptArguments(claude, "{}")
  expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""])
  expect(args).toContain("--safe-mode")
  const antigravity = await connection("antigravity")
  await prepareCliWorkspace(antigravity)
  expect(await readFile(join(antigravity.directory, ".agents/agents/edu-tutor.md"), "utf8")).toContain("tools: [finish]")
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

test.each(["claude", "antigravity"] as const)("%s can persist structured topic summaries", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain slowly and record my limit difficulty.", createdAt: new Date().toISOString(), topicIds: [] })
  const topic = newTopic("Limits")
  topic.planConfirmed = true
  topic.learning.notes = "# Limits\n\n<topic-directory heading=\"Topic directory\" items='[{\"title\":\"1. Limits\"}]' />\n\n## Limits\n\nOriginal learner answer."
  const job = WorkerJobSchema.parse({
    chat, topics: [{ ...topic, assetDirectory: cli.directory }],
    runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const actions = [
    { reply: "I’ll explain slowly. Let’s clarify approaching a limit.", calls: [
      { name: "topic_updateTopic", arguments: JSON.stringify({ topicId: "scratchpad_1", summary: "A limit describes the approached value." }) },
      { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    ] },
  ]
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    const action = actions.shift()
    if (!action) throw new Error("Unexpected CLI request")
    if (provider === "antigravity") return JSON.stringify({ status: "SUCCESS", structured_output: action })
    return JSON.stringify({ type: "result", is_error: false, structured_output: action })
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.topicMutations).toMatchObject([{ type: "updateTopic", topicId: topic.id, summary: "A limit describes the approached value." }])
  expect(command).toHaveBeenCalledTimes(1)
})


test("Antigravity title generation allows the full CLI startup deadline", async () => {
  const cli = await connection("antigravity")
  const runner = WorkerJobSchema.shape.runner.parse({ id: randomUUID(), name: "Tutor", provider: "antigravity", model: "default" })
  const command = vi.spyOn(cliTools, "runCliCommand").mockResolvedValue(JSON.stringify({ status: "SUCCESS", structured_output: { title: "Introduction to Limits" } }))
  await expect(generateTopicTitle({ cli, runner }, "Teach me limits", () => {}, () => {})).resolves.toBe("Introduction to Limits")
  expect(command.mock.calls[0][4]).toBe(120_000)
})


test.each(["claude", "antigravity"] as const)("%s returns a reply and validated handoff in one provider call", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const topic = newTopic("Lecture 6 — MIPS Part 1")
  const job = WorkerJobSchema.parse({
    chat, topics: [{ ...topic, assetDirectory: cli.directory }], openedTopicId: topic.id,
    runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const reply = "This topic is Lecture 6 — MIPS Part 1."
  const action = { reply, calls: [{ name: "save_learning_state", arguments: JSON.stringify(chat.learning) }] }
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    if (command.mock.calls.length > 1) throw new Error("Unnecessary second provider call")
    if (provider === "antigravity") return JSON.stringify({ status: "SUCCESS", structured_output: action })
    return JSON.stringify({ is_error: false, structured_output: action })
  })
  const nodes: string[] = []
  const result = await runCliTutorTurn(job, () => {}, () => {}, (event, details) => {
    if (event === "graph.node" && typeof details.node === "string") nodes.push(details.node)
  })
  expect(nodes).toEqual(["model", "execute_tools", "validate", "publish"])
  expect(result.reply).toBe(reply)
  expect(result.learning).toEqual(chat.learning)
  expect(command).toHaveBeenCalledTimes(1)
})

test.each(["claude", "antigravity"] as const)("%s withholds a combined reply until rejected saves are corrected", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({
    chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const actions = [
    { reply: "Do not publish this rejected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify({ ...chat.learning, workpad: "" }) }] },
    { reply: "Corrected reply", calls: [{ name: "save_learning_state", arguments: JSON.stringify(chat.learning) }] },
  ]
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    const action = actions.shift()
    if (!action) throw new Error("Unexpected provider request")
    if (provider === "antigravity") return JSON.stringify({ status: "SUCCESS", structured_output: action })
    return JSON.stringify({ is_error: false, structured_output: action })
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe("Corrected reply")
  expect(command).toHaveBeenCalledTimes(2)
  expect(command.mock.calls[1][2]).toContain("Tool error:")
})

test("a reply accompanying source reads waits for the tool results", async () => {
  const cli = await connection("antigravity")
  const chat = newChat(randomUUID())
  const job = WorkerJobSchema.parse({
    chat, topics: [], runner: { id: chat.runnerId, name: "Tutor", provider: "antigravity", model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const actions = [
    { reply: "Premature reply", calls: [
      { name: "read_skill", arguments: JSON.stringify({ path: "skills/MANAGE_TOPIC.md" }) },
      { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    ] },
    { reply: "Reply using the tool results", calls: [] },
  ]
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    const action = actions.shift()
    if (!action) throw new Error("Unexpected provider request")
    return JSON.stringify({ status: "SUCCESS", structured_output: action })
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe("Reply using the tool results")
  expect(command).toHaveBeenCalledTimes(2)
  expect(command.mock.calls[1][2]).toContain('"tool":"read_skill"')
})

test.each(["claude", "antigravity"] as const)("%s consumes cross-topic retrieval results before publishing a review", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  chat.messages.push({ id: randomUUID(), role: "user", content: "Across all topics, what are my past mistakes?", createdAt: new Date().toISOString(), topicIds: [] })
  const topic = newTopic("Archived physics")
  const evidence = "Learner confused speed with acceleration; later resolved."
  const job = WorkerJobSchema.parse({
    chat, topics: [], workspaceTopics: [{ id: topic.id, title: topic.title, archived: true, notes: evidence }],
    runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const actions = [
    { reply: "Premature review", calls: [
      { name: "read_scratchpad", arguments: JSON.stringify({ scratchpadId: "scratchpad_1" }) },
      { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    ] },
    { reply: evidence, calls: [] },
  ]
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    const action = actions.shift()
    if (!action) throw new Error("Unexpected CLI request")
    if (provider === "antigravity") return JSON.stringify({ status: "SUCCESS", structured_output: action })
    return JSON.stringify({ type: "result", is_error: false, structured_output: action })
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.reply).toBe(evidence)
  expect(result.topicUpdates).toEqual([])
  expect(command).toHaveBeenCalledTimes(2)
  expect(command.mock.calls[1][2]).toContain(evidence)
})
