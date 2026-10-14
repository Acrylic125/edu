import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import * as cli from "../src/providers/cli"
import { ProviderSettingsSchema } from "../src/shared/contracts"
import { randomUUID } from "node:crypto"
import { afterEach, expect, test, vi } from "vitest"
import { ProviderRegistry } from "../src/providers/registry"
import { CodexProvider } from "../src/providers/codex"
import { ModelAccount } from "../src/main/account"

vi.mock("electron", () => ({ shell: {}, safeStorage: {} }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function model(id: string, prompt = "0", completion = "0", request = "0") {
  return {
    id, name: id, supported_parameters: [],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt, completion, request },
  }
}

test("chooses the least expensive text model from live prices, including models without tools", async () => {
  vi.spyOn(cli, "resolveCliExecutable").mockRejectedValue(new Error("Not installed"))
  vi.spyOn(CodexProvider.prototype, "refresh").mockResolvedValue()
  vi.spyOn(ModelAccount.prototype, "key").mockResolvedValue("test-key")
  let catalog = [
    model("openrouter/auto", "-1", "-1"),
    { ...model("image-only"), architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    { ...model("missing-prices"), pricing: undefined },
    model("expensive", "0.001", "0.002"),
    model("cheap", "0.000001", "0.000002"),
    model("request-fee", "0", "0", "0.01"),
  ]
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: { is_free_tier: false } })
    return Response.json({ data: catalog })
  })
  vi.stubGlobal("fetch", fetcher)
  const registry = new ProviderRegistry("/tmp/prune-provider-test", "unused", () => {})
  const runner = { id: randomUUID(), name: "Tutor", provider: "openrouter" as const, model: "expensive" }
  await registry.refresh()
  expect((await registry.connection(runner)).titleModel?.id).toBe("cheap")
  expect(registry.statuses.find((provider) => provider.id === "openrouter")?.error).toBeUndefined()
  expect(registry.statuses.find((provider) => provider.id === "openrouter")?.models.map((model) => model.id)).toEqual(["openrouter/auto"])
  catalog = [...catalog, model("free")]
  await registry.refresh()
  expect((await registry.connection(runner)).titleModel?.id).toBe("free")
  expect(runner.model).toBe("expensive")
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
  vi.spyOn(registry.openrouter, "load").mockResolvedValue()
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
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(registry.statuses.every((provider) => provider.installed && provider.checkedAt)).toBe(true)
    expect(registry.statuses.find((provider) => provider.id === "antigravity")?.connected).toBe(true)
    await vi.advanceTimersByTimeAsync(299_999)
    expect(codex).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const periodic = poll.mock.results.at(-1)
    if (periodic?.type === "return") await periodic.value
    expect(codex).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
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

test("OpenRouter checks invalidate a revoked account key and recover after reconnecting", async () => {
  const registry = new ProviderRegistry("/tmp/edu-provider-key-check", "unused", () => {})
  vi.spyOn(registry.openrouter, "load").mockImplementation(async () => { registry.openrouter.connected = true })
  vi.spyOn(registry.openrouter, "key").mockResolvedValue("test-key")
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", fetcher)
  try {
    await registry.refresh("openrouter")
    expect(registry.statuses.find((provider) => provider.id === "openrouter")?.connected).toBe(false)
    expect(registry.statuses.find((provider) => provider.id === "openrouter")?.error).toContain("sign-in has expired")
    fetcher.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
      if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: { is_free_tier: false } })
      return Response.json({ data: [] })
    })
    await registry.refresh("openrouter")
    expect(registry.statuses.find((provider) => provider.id === "openrouter")?.connected).toBe(true)
    expect(registry.statuses.find((provider) => provider.id === "openrouter")?.error).toBeUndefined()
  } finally {
    registry.close()
  }
})


test("a pending account check cannot undo an explicit disconnect", async () => {
  const registry = new ProviderRegistry("/tmp/edu-disconnect-race", "unused", () => {})
  let hasKey = true
  vi.spyOn(registry.openrouter, "load").mockImplementation(async () => { registry.openrouter.connected = hasKey })
  vi.spyOn(registry.openrouter, "key").mockResolvedValue("test-key")
  const disconnect = vi.spyOn(registry.openrouter, "disconnect").mockImplementation(async () => {
    hasKey = false
    registry.openrouter.connected = false
  })
  let finish = () => {}
  const account = new Promise<Response>((resolve) => { finish = () => resolve(Response.json({ data: { is_free_tier: false } })) })
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    if (url === "https://openrouter.ai/api/v1/key") return account
    return Response.json({ data: [] })
  })
  vi.stubGlobal("fetch", fetcher)
  try {
    const checking = registry.refresh("openrouter")
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const disconnecting = registry.disconnect("openrouter")
    expect(disconnect).not.toHaveBeenCalled()
    finish()
    await Promise.all([checking, disconnecting])
    expect(registry.openrouter.connected).toBe(false)
    await registry.refresh("openrouter")
    expect(registry.openrouter.connected).toBe(false)
    expect(fetcher.mock.calls.filter(([url]) => url === "https://openrouter.ai/api/v1/key")).toHaveLength(1)
  } finally {
    registry.close()
  }
})
