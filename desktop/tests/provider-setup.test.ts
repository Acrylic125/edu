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
