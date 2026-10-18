import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import * as cli from "../src/providers/cli"
import { ProviderSettingsSchema, RunnerInputSchema } from "../src/shared/contracts"
import { randomUUID } from "node:crypto"
import { afterEach, expect, test, vi } from "vitest"
import { ProviderRegistry } from "../src/providers/registry"
import { CodexProvider } from "../src/providers/codex"

vi.mock("electron", () => ({ shell: {}, safeStorage: {} }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

test("Claude Connect signs in when the installed CLI is signed out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-cli-login-"))
  const executable = resolve("tests/fixtures/provider-cli.mjs")
  const authFile = join(directory, "auth")
  await chmod(executable, 0o755)
  vi.stubEnv("EDU_TEST_CLI_AUTH_FILE", authFile)
  const settings = ProviderSettingsSchema.parse({ id: "claude", displayName: "Claude", binaryPath: executable })
  const registry = new ProviderRegistry(directory, "unused", () => {}, [settings])
  try {
    await registry.connect("claude")
    expect(await readFile(authFile, "utf8")).toBe("signed-in")
    expect(registry.statuses.find((provider) => provider.id === "claude")?.connected).toBe(true)
  } finally {
    registry.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("checks all providers immediately and every five minutes, with no login or generation during polls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-polling-test-"))
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-14T00:00:00Z"))
  const settings = ["claude", "antigravity"].map((id) => ProviderSettingsSchema.parse({ id, displayName: id, binaryPath: "/fixture-cli", enabled: true }))
  const registry = new ProviderRegistry(directory, "unused", () => {}, settings)
  const codex = vi.spyOn(registry.codex, "refresh").mockImplementation(async () => {
    registry.codex.state.installed = true
    registry.codex.state.connected = true
    registry.codex.state.checkedAt = new Date().toISOString()
  })
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ data: [] }))
  vi.stubGlobal("fetch", fetcher)
  const resolver = vi.spyOn(cli, "resolveCliExecutable").mockResolvedValue("/fixture-cli")
  const command = vi.spyOn(cli, "runCliCommand").mockImplementation(async (connection, args) => {
    if (connection.provider === "claude") return JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })
    if (args[0] === "models") return "gemini-test  Gemini fixture model"
    return "Account quotas available"
  })
  const poll = vi.spyOn(registry, "refresh")
  try {
    registry.startPolling()
    registry.startPolling()
    const initial = poll.mock.results.at(-1)
    if (initial?.type === "return") await initial.value
    expect(codex).toHaveBeenCalledTimes(1)
    expect(fetcher).not.toHaveBeenCalled()
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(registry.statuses.every((provider) => provider.installed && provider.checkedAt)).toBe(true)
    expect(registry.statuses.find((provider) => provider.id === "antigravity")?.connected).toBe(true)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(codex).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const periodic = poll.mock.results.at(-1)
    if (periodic?.type === "return") await periodic.value
    expect(codex).toHaveBeenCalledTimes(2)
    expect(fetcher).not.toHaveBeenCalled()
    expect(resolver).toHaveBeenCalledTimes(4)
    expect(command.mock.calls.filter(([, args]) => args.includes("/usage"))).toHaveLength(2)
    expect(command.mock.calls.some(([, args]) => args.includes("login") || args.includes("--json-schema"))).toBe(false)
    await registry.disconnect("antigravity")
    await registry.refresh("antigravity")
    expect(registry.statuses.find((provider) => provider.id === "antigravity")?.connected).toBe(false)
    expect(command.mock.calls.filter(([, args]) => args.includes("/usage"))).toHaveLength(2)
    registry.close()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(codex).toHaveBeenCalledTimes(2)
  } finally {
    registry.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("manual checks reuse pending checks and skip providers during sign-in or after shutdown", async () => {
  const registry = new ProviderRegistry("/tmp/edu-provider-overlap", "unused", () => {})
  let finish = () => {}
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const refresh = vi.spyOn(registry.codex, "refresh").mockReturnValue(pending)
  const first = registry.refresh("codex")
  const second = registry.refresh("codex")
  expect(refresh).toHaveBeenCalledTimes(1)
  finish()
  await Promise.all([first, second])
  registry.codex.state.connecting = true
  await registry.refresh("codex")
  expect(refresh).toHaveBeenCalledTimes(1)
  registry.close()
  await registry.refresh()
  expect(refresh).toHaveBeenCalledTimes(1)
})

test("CLI checks discover installation separately from connection and notice removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-installation-test-"))
  const registry = new ProviderRegistry(directory, "unused", () => {})
  const resolver = vi.spyOn(cli, "resolveCliExecutable").mockRejectedValue(new Error("Not installed"))
  const command = vi.spyOn(cli, "runCliCommand").mockResolvedValue(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }))
  try {
    await registry.refresh("claude")
    expect(registry.statuses.find((provider) => provider.id === "claude")).toMatchObject({ installed: false, connected: false })
    expect(command).not.toHaveBeenCalled()
    resolver.mockResolvedValue("/fixture-cli")
    await registry.refresh("claude")
    expect(registry.statuses.find((provider) => provider.id === "claude")).toMatchObject({ installed: true, connected: false })
    registry.configure(ProviderSettingsSchema.parse({ id: "claude", displayName: "Claude", binaryPath: "/fixture-cli", enabled: true }))
    await registry.refresh("claude")
    expect(registry.statuses.find((provider) => provider.id === "claude")?.connected).toBe(true)
    resolver.mockRejectedValue(new Error("Removed"))
    await registry.refresh("claude")
    expect(registry.statuses.find((provider) => provider.id === "claude")).toMatchObject({ installed: false, connected: false })
    expect(registry.statuses.find((provider) => provider.id === "claude")?.error).toBeUndefined()
  } finally {
    registry.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("Antigravity discovers tab-separated models from the CLI catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-agy-models-"))
  const registry = new ProviderRegistry(directory, "unused", () => {}, [
    ProviderSettingsSchema.parse({ id: "antigravity", displayName: "Antigravity", binaryPath: "/fixture-cli", enabled: true }),
  ])
  vi.spyOn(cli, "resolveCliExecutable").mockResolvedValue("/fixture-cli")
  vi.spyOn(cli, "runCliCommand").mockImplementation(async (_connection, args) => {
    if (args[0] === "models") return "Fetching available models...\n gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n"
    return "Account quotas available"
  })
  try {
    await registry.refresh("antigravity")
    expect(registry.statuses.find((provider) => provider.id === "antigravity")?.models).toMatchObject([
      { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    ])
  } finally {
    registry.close()
    await rm(directory, { recursive: true, force: true })
  }
})


test("Claude exposes concrete models without a default sentinel", async () => {
  const registry = new ProviderRegistry("/tmp/edu-claude-models", "unused", () => {})
  vi.spyOn(cli, "resolveCliExecutable").mockResolvedValue("/fixture-cli")
  vi.spyOn(cli, "runCliCommand").mockResolvedValue(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }))
  try {
    await registry.refresh("claude")
    const models = registry.statuses.find((provider) => provider.id === "claude")?.models
    expect(models).toContainEqual(expect.objectContaining({ id: "claude-haiku-5-5", name: "Haiku 5.5" }))
    expect(models?.some((model) => model.id === "default")).toBe(false)
    expect(() => registry.validateRunner({ name: "Tutor", provider: "claude", model: "default" })).toThrow("Choose an available model")
  } finally {
    registry.close()
  }
})


test.each([
  ["codex", "gpt-6-luna"],
  ["claude", "claude-haiku-5-5"],
  ["antigravity", "gemini-3.8-flash-high"],
])("%s uses its concrete model when a runner omits the model", (provider, model) => {
  expect(RunnerInputSchema.parse({ name: "Tutor", provider }).model).toBe(model)
  expect(RunnerInputSchema.parse({ name: "Tutor", provider, model: "chosen-model", reasoningEffort: "high" }))
    .toMatchObject({ model: "chosen-model", reasoningEffort: "high" })
  expect(RunnerInputSchema.parse({ name: "Tutor", provider, reasoningEffort: "high" }))
    .toMatchObject({ model, reasoningEffort: "high" })
})
