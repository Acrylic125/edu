import { randomUUID } from "node:crypto"
import { afterEach, expect, test, vi } from "vitest"
import { ProviderRegistry } from "../src/providers/registry"
import { CodexProvider } from "../src/providers/codex"
import { ModelAccount } from "../src/main/account"

vi.mock("electron", () => ({ shell: {}, safeStorage: {} }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function model(id: string, prompt = "0", completion = "0", request = "0") {
  return {
    id, name: id, supported_parameters: [],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt, completion, request },
  }
}

test("chooses the least expensive text model from live prices, including models without tools", async () => {
  vi.spyOn(CodexProvider.prototype, "refresh").mockResolvedValue()
  vi.spyOn(ModelAccount.prototype, "key").mockResolvedValue("test-key")
  const catalog = [
    model("openrouter/auto", "-1", "-1"),
    { ...model("image-only"), architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    { ...model("missing-prices"), pricing: undefined },
    model("expensive", "0.001", "0.002"),
    model("cheap", "0.000001", "0.000002"),
    model("request-fee", "0", "0", "0.01"),
  ]
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: catalog }))
  vi.stubGlobal("fetch", fetcher)
  const registry = new ProviderRegistry("/tmp/prune-provider-test", "unused", () => {})
  const runner = { id: randomUUID(), name: "Tutor", provider: "openrouter" as const, model: "expensive" }
  await registry.refresh()
  expect((await registry.connection(runner)).titleModel?.id).toBe("cheap")
  expect(registry.statuses.find((provider) => provider.id === "openrouter")?.error).toBeUndefined()
  expect(registry.statuses.find((provider) => provider.id === "openrouter")?.models.map((model) => model.id)).toEqual(["openrouter/auto"])
  fetcher.mockResolvedValue(Response.json({ data: [...catalog, model("free")] }))
  await registry.refresh()
  expect((await registry.connection(runner)).titleModel?.id).toBe("free")
  expect(runner.model).toBe("expensive")
})
