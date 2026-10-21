import { expect, test } from "vitest"
import { ProviderIdSchema, RunnerInputSchema, WorkspaceSchema, providerDefaultModels } from "../src/shared/contracts"
import { newChat } from "../src/main/workspace"
import { randomUUID } from "node:crypto"

test("only subscription providers can be selected", () => {
  expect(ProviderIdSchema.options).toEqual(["codex", "claude", "antigravity"])
  expect(RunnerInputSchema.safeParse({ name: "Tutor", provider: "openrouter" }).success).toBe(false)
  expect(RunnerInputSchema.parse({ name: "Tutor" }).provider).toBe("codex")
})

test("saved OpenRouter runners migrate without losing their identities or chats", () => {
  const id = randomUUID()
  const chat = newChat(id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Saved lesson", topicIds: [], createdAt: new Date().toISOString() })
  const workspace = WorkspaceSchema.parse({ version: 2, runners: [{ id, name: "Tutor", provider: "openrouter", model: "openrouter/auto" }], topics: [], chats: [chat], providerSettings: [{ id: "openrouter", displayName: "OpenRouter" }] })
  expect(workspace.runners[0]).toMatchObject({ id, provider: "codex", model: providerDefaultModels.codex })
  expect(workspace.providerSettings).toEqual([])
  expect(workspace.chats).toEqual([chat])
})
