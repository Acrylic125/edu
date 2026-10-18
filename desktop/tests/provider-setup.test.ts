import { expect, test, vi } from "vitest"
import { ProviderStatusSchema } from "../src/shared/contracts"

test("provider setup stays complete for a window and resets when reopened", async () => {
  vi.resetModules()
  const { useWorkspace } = await import("../src/renderer/store")
  const snapshot = useWorkspace.getState().snapshot
  const provider = ProviderStatusSchema.parse({ id: "codex", name: "ChatGPT", connected: false, models: [] })

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [provider] })
  expect(useWorkspace.getState().providerSetupComplete).toBe(false)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [{ ...provider, connected: true }] })
  expect(useWorkspace.getState().providerSetupComplete).toBe(true)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [provider] })
  expect(useWorkspace.getState().providerSetupComplete).toBe(true)

  vi.resetModules()
  const reopened = await import("../src/renderer/store")
  reopened.useWorkspace.getState().setSnapshot({ ...snapshot, providers: [provider] })
  expect(reopened.useWorkspace.getState().providerSetupComplete).toBe(false)
})

test("opening with a connected provider skips setup", async () => {
  vi.resetModules()
  const { useWorkspace } = await import("../src/renderer/store")
  useWorkspace.getState().setSnapshot({
    ...useWorkspace.getState().snapshot,
    providers: [ProviderStatusSchema.parse({ id: "claude", name: "Claude", connected: true, models: [] })],
  })
  expect(useWorkspace.getState().providerSetupComplete).toBe(true)
})

test("startup waits for provider checks before deciding setup is required", async () => {
  vi.resetModules()
  const { useWorkspace } = await import("../src/renderer/store")
  const snapshot = useWorkspace.getState().snapshot
  const provider = ProviderStatusSchema.parse({ id: "codex", name: "ChatGPT", connected: false, loading: true, models: [] })

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [provider] })
  expect(useWorkspace.getState().loaded).toBe(false)
  expect(useWorkspace.getState().providerSetupComplete).toBe(false)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [{ ...provider, loading: false, connected: true }] })
  expect(useWorkspace.getState().loaded).toBe(true)
  expect(useWorkspace.getState().providerSetupComplete).toBe(true)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [provider] })
  expect(useWorkspace.getState().loaded).toBe(true)
})

test("startup shows setup once every provider check finishes without a connected account", async () => {
  vi.resetModules()
  const { useWorkspace } = await import("../src/renderer/store")
  const snapshot = useWorkspace.getState().snapshot
  const codex = ProviderStatusSchema.parse({ id: "codex", name: "ChatGPT", connected: false, models: [] })
  const openrouter = ProviderStatusSchema.parse({ id: "openrouter", name: "OpenRouter", connected: false, loading: true, models: [] })

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [codex, openrouter] })
  expect(useWorkspace.getState().loaded).toBe(false)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [codex, { ...openrouter, loading: false, error: "Account check failed" }] })
  expect(useWorkspace.getState().loaded).toBe(true)
  expect(useWorkspace.getState().providerSetupComplete).toBe(false)

  useWorkspace.getState().setSnapshot({ ...snapshot, providers: [codex, openrouter] })
  expect(useWorkspace.getState().loaded).toBe(true)
})

test("a connected provider opens the workspace while other startup checks are pending", async () => {
  vi.resetModules()
  const { useWorkspace } = await import("../src/renderer/store")
  useWorkspace.getState().setSnapshot({
    ...useWorkspace.getState().snapshot,
    providers: [
      ProviderStatusSchema.parse({ id: "codex", name: "ChatGPT", connected: true, models: [] }),
      ProviderStatusSchema.parse({ id: "openrouter", name: "OpenRouter", connected: false, loading: true, models: [] }),
    ],
  })
  expect(useWorkspace.getState().loaded).toBe(true)
  expect(useWorkspace.getState().providerSetupComplete).toBe(true)
})
