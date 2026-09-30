import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react", () => ({ cache: (callback: (...args: string[]) => Promise<object>) => callback }))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND") } }))
vi.mock("@/lib/auth-server", () => ({ getSession: vi.fn() }))
vi.mock("./http", async (importOriginal) => {
  const http = await importOriginal<typeof import("./http")>()
  return { ...http, fetchTopics: vi.fn(), fetchTopicMessages: vi.fn() }
})
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_API_URL: "http://api.test" } }))

import { getSession } from "@/lib/auth-server"
import { fetchTopics, fetchTopicMessages } from "./http"
import { loadChatBootstrap } from "./load-bootstrap"
import type { CurrentMessagesPayload } from "./types"

const topic = {
  id: "topic_requested", title: "Requested chat", summary: "", plan: [],
  updatedAt: "2026-09-30T00:00:00.000Z", document: { markdown: "Notes", updatedAt: "2026-09-30T00:00:00.000Z" },
}
const payload = { topic, messages: [] } satisfies CurrentMessagesPayload

beforeEach(() => {
  vi.clearAllMocks()
  // Only the token is needed by this boundary; the full session remains validated by Better Auth.
  vi.mocked(getSession).mockResolvedValue({ session: { token: "fixture-token" } } as NonNullable<Awaited<ReturnType<typeof getSession>>>)
  vi.mocked(fetchTopics).mockResolvedValue({ byId: {}, order: [] })
  vi.mocked(fetchTopicMessages).mockResolvedValue(payload)
})

describe("chat URL bootstrap", () => {
  it("opens /chat as a new conversation without loading the global selection", async () => {
    expect((await loadChatBootstrap()).session).toEqual({ kind: "none" })
    expect(fetchTopicMessages).not.toHaveBeenCalled()
  })

  it("loads the exact chat from the URL and adds it to the sidebar catalog", async () => {
    const bootstrap = await loadChatBootstrap(topic.id)
    expect(fetchTopicMessages).toHaveBeenCalledWith("fixture-token", topic.id)
    expect(bootstrap.session).toMatchObject({ kind: "topic", topicId: topic.id, document: topic.document })
    expect(bootstrap.catalog.order).toEqual([topic.id])
  })

  it("returns not found for missing or inaccessible chats", async () => {
    vi.mocked(fetchTopicMessages).mockResolvedValue(null)
    await expect(loadChatBootstrap("topic_missing")).rejects.toThrow("NOT_FOUND")
  })

  it("never renders another chat if the API returns a different ID", async () => {
    await expect(loadChatBootstrap("topic_other")).rejects.toThrow("NOT_FOUND")
  })
})
