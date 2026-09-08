import { describe, expect, it } from "vitest"
import { reduceSession } from "./session-reduce"
import type { ChatSession, RunFact } from "./types"

const session: ChatSession = {
  kind: "topic",
  topicId: "t1",
  title: "Vectors",
  summary: "Learn vectors",
  plan: [],
  updatedAt: "2026-09-08T00:00:00.000Z",
  handoff: null,
  messages: [
    {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", content: "Partial" }],
      status: "streaming",
    },
  ],
}
const run: RunFact = { status: "running", runId: "r1", messageId: "m1" }
describe("chat run events", () => {
  it("ignores deltas and completion from a previous run", () => {
    for (const message of [
      {
        type: "run.delta" as const,
        runId: "old",
        messageId: "m1",
        partIndex: 0,
        text: "stale",
      },
      {
        type: "run.ended" as const,
        runId: "old",
        messageId: "m1",
        status: "completed" as const,
        parts: [],
      },
    ])
      expect(reduceSession(session, run, { type: "ws", message })).toEqual({
        session,
        run,
      })
  })

  it("uses the plan returned by a completed update", () => {
    const steps = [{ id: "products", label: "Vector products", summary: "Dot and cross products", parent: null }]
    const result = reduceSession(session, run, {
      type: "ws",
      message: {
        type: "run.ended",
        runId: "r1",
        messageId: "m1",
        status: "completed",
        parts: [{ type: "text", content: "Learning plan updated!" }, { type: "plan", steps }],
      },
    })

    expect(result.session).toMatchObject({ plan: steps })
  })
  it("keeps failure distinct from completion", () => {
    const result = reduceSession(session, run, {
      type: "ws",
      message: {
        type: "run.ended",
        runId: "r1",
        messageId: "m1",
        status: "failed",
        parts: [],
      },
    })
    expect(result.session).toMatchObject({
      messages: [{ status: "failed", parts: [{ content: "Partial" }] }],
    })
    expect(result.run.status).toBe("idle")
  })
  it("settles streaming indicators when the socket closes", () => {
    const result = reduceSession(session, run, { type: "socket_closed" })
    expect(result.session).toMatchObject({ messages: [{ status: "failed" }] })
  })
  it("preserves optimistic content when a topic gets its permanent id", () => {
    const result = reduceSession(session, run, {
      type: "topic_born",
      topicId: "new",
      previous: null,
    })
    expect(result.session).toMatchObject({
      topicId: "new",
      messages: session.messages,
    })
  })

  it("removes options from previous responses when a new run starts", () => {
    const withOptions: ChatSession = {
      kind: "topic",
      topicId: "t1",
      title: "Vectors",
      summary: "Learn vectors",
      plan: [],
      updatedAt: "2026-09-08T00:00:00.000Z",
      handoff: null,
      messages: [
        {
          id: "old",
          role: "assistant",
          parts: [
            { type: "text", content: "Previous response" },
            { type: "options", options: [{ label: "Continue" }] },
          ],
          status: "complete",
        },
      ],
    }

    const result = reduceSession(withOptions, { status: "idle" }, {
      type: "ws",
      message: {
        type: "run.started",
        runId: "r2",
        messageId: "new",
      },
    })

    expect(result.session).toMatchObject({
      messages: [
        { id: "old", parts: [{ type: "text", content: "Previous response" }] },
        { id: "new", status: "streaming" },
      ],
    })
  })

  it("removes previous options as soon as the user sends a message", () => {
    const withOptions: ChatSession = {
      kind: "topic",
      topicId: "t1",
      title: "Vectors",
      summary: "Learn vectors",
      plan: [],
      updatedAt: "2026-09-08T00:00:00.000Z",
      handoff: null,
      messages: [
        {
          id: "old",
          role: "assistant",
          parts: [
            { type: "text", content: "Previous response" },
            { type: "options", options: [{ label: "Continue" }] },
          ],
          status: "complete",
        },
      ],
    }

    const result = reduceSession(withOptions, { status: "idle" }, {
      type: "user_sent",
      messageId: "question",
      content: "What topic are we at?",
      attachments: [],
    })

    expect(result.session).toMatchObject({
      messages: [
        { id: "old", parts: [{ type: "text", content: "Previous response" }] },
        { id: "question", role: "user" },
      ],
    })
  })
})
