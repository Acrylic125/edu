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
  const title = await generateTopicTitle({ cli, runner }, "Teach me limits", undefined, processChanged, () => {})
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
  expect(diagnostic).toHaveBeenCalledWith("tool.result", { tool: "save_learning_state", success: false })
  expect(diagnostic).toHaveBeenCalledWith("tool.result", { tool: "save_learning_state", success: true })
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

test.each(["claude", "antigravity"] as const)("%s can persist behaviour preferences and bounded difficulty updates", async (provider) => {
  const cli = await connection(provider)
  const chat = newChat(randomUUID())
  chat.messages.push({ id: randomUUID(), role: "user", content: "Explain slowly and record my limit difficulty.", createdAt: new Date().toISOString(), topicIds: [] })
  const topic = newTopic("Limits")
  topic.planConfirmed = true
  topic.learning.notes = "# Limits\n\n<topic-directory heading=\"Topic directory\" items='[{\"title\":\"1. Limits\"}]' />\n\n## Limits\n\nOriginal learner answer."
  const job = WorkerJobSchema.parse({
    chat, topics: [{ ...topic, assetDirectory: cli.directory }], behaviourMemory: "Use source examples.",
    runner: { id: chat.runnerId, name: "Tutor", provider, model: "default" }, cli,
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: cli.directory,
  })
  const actions = [
    { reply: "", calls: [
      { name: "save_behaviour_memory", arguments: JSON.stringify({ expected: job.behaviourMemory, content: "Use source examples.\nExplain slowly." }) },
      { name: "revise_topic_state", arguments: JSON.stringify({ topicId: topic.id, notes: { append: "D1: needs_explanation — Needs the approach/reach distinction explained." } }) },
      { name: "save_learning_state", arguments: JSON.stringify(chat.learning) },
    ] },
    { reply: "I’ll explain slowly. Let’s clarify approaching a limit.", calls: [] },
  ]
  const command = vi.spyOn(cliTools, "runCliCommand").mockImplementation(async () => {
    const action = actions.shift()
    if (!action) throw new Error("Unexpected CLI request")
    if (provider === "antigravity") return JSON.stringify({ status: "SUCCESS", structured_output: action })
    return JSON.stringify({ type: "result", is_error: false, structured_output: action })
  })
  const result = await runCliTutorTurn(job, () => {}, () => {})
  expect(result.behaviourUpdate).toEqual({ expected: job.behaviourMemory, content: "Use source examples.\nExplain slowly." })
  expect(result.topicUpdates[0].learning.notes).toContain("Original learner answer.")
  expect(result.topicUpdates[0].learning.notes).toContain("D1: needs_explanation")
  expect(command).toHaveBeenCalledTimes(2)
})
