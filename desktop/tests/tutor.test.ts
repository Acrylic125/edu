import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import OpenAI from "openai"
import type { ChatCompletionMessage } from "openai/resources/chat/completions"
import { afterEach, expect, test } from "vitest"
import { newTopic } from "../src/main/workspace"
import { runTutorTurn } from "../src/runners/tutor"
import { generateTopicTitle } from "../src/runners/title"
import { ProviderModelSchema } from "../src/shared/contracts"
import type { LearningState, WorkerJob } from "../src/shared/contracts"

const servers: ReturnType<typeof createServer>[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function provider(responses: ChatCompletionMessage[]) {
  const requests: string[] = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    requests.push(body)
    const message = responses.shift() ?? {
      role: "assistant",
      content: "Forgot to save",
      refusal: null,
    }
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(
      JSON.stringify({
        id: "test",
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [
          {
            index: 0,
            finish_reason: message.tool_calls ? "tool_calls" : "stop",
            message,
          },
        ],
      }),
    )
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("No server address")
  return {
    client: new OpenAI({
      apiKey: "test-only",
      baseURL: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
    }),
    requests,
  }
}

function job() {
  const runner = {
    id: randomUUID(),
    name: "Tutor",
    provider: "openrouter" as const,
    model: "test",
  }
  const topic = newTopic("Limits", runner.id)
  topic.messages.push({
    id: randomUUID(),
    role: "user",
    content: "Teach me limits",
    createdAt: new Date().toISOString(),
  })
  return {
    topic,
    runner,
    apiKey: "test-only",
    action: "message",
    skillDirectory: resolve("resources/tutor-me"),
    assetDirectory: resolve("tests"),
  } satisfies WorkerJob
}
function save(state: LearningState): ChatCompletionMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [
      {
        id: randomUUID(),
        type: "function",
        function: {
          name: "save_learning_state",
          arguments: JSON.stringify(state),
        },
      },
    ],
  }
}
function reply(content: string): ChatCompletionMessage {
  return { role: "assistant", content, refusal: null }
}

test("requires a valid saved handoff before returning a learner reply", async () => {
  const input = job()
  const state = {
    ...input.topic.learning,
    outline: ["1. Intuition", "2. Formal limits"],
    notes: "# Limits\n\nDraft plan.",
    workpad: "Awaiting confirmation",
  }
  const { client, requests } = await provider([
    reply("Unsaved plan"),
    save(state),
    reply("Review this plan before we begin."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.learning).toEqual(state)
  expect(requests).toHaveLength(3)
  expect(requests[1]).toContain("Save the complete learning state")
})

test("prevents an unconfirmed plan from advancing to teaching", async () => {
  const input = job()
  const invalid = {
    ...input.topic.learning,
    phase: "ready_to_continue" as const,
    notes: "Taught limits",
    workpad: "Skip confirmation",
  }
  const corrected = {
    ...input.topic.learning,
    outline: ["Limits"],
    workpad: "Wait for confirmation",
  }
  const { client, requests } = await provider([
    save(invalid),
    save(corrected),
    reply("Please confirm this plan."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.learning.phase).toBe("awaiting_plan_confirmation")
  expect(requests[1]).toContain("Wait for the learner to confirm")
})

test("a rejected replacement save cannot publish an older staged state", async () => {
  const input = job()
  const valid = { ...input.topic.learning, outline: ["Limits"] }
  const invalid = { ...valid, notes: "" }
  const corrected = { ...valid, notes: "# Limits\n\nRevised draft plan." }
  const { client, requests } = await provider([
    save(valid),
    save(invalid),
    reply("Review my revised plan."),
    save(corrected),
    reply("Please confirm the revised plan."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.learning).toEqual(corrected)
  expect(requests).toHaveLength(5)
})

test("resumes a pending question and withholds the checked key from visible output", async () => {
  const input = job()
  input.topic.planConfirmed = true
  const state = {
    ...input.topic.learning,
    phase: "awaiting_answer" as const,
    pendingQuestion: "Explain what a limit describes.",
    privateAnswerKey:
      "A limit describes the approached value as the input approaches a point.",
    workpad: "Pending Check; no learner attempt.",
  }
  input.topic.learning = state
  const { client, requests } = await provider([
    save(state),
    reply(state.pendingQuestion),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.reply).toBe(state.pendingQuestion)
  expect(requests[0]).toContain(state.privateAnswerKey)
  expect(result.reply).not.toContain(state.privateAnswerKey)
})

test("rejects a pending answer key echoed into the learner reply", async () => {
  const input = job()
  input.topic.planConfirmed = true
  const state = {
    ...input.topic.learning,
    phase: "awaiting_answer" as const,
    pendingQuestion: "Explain limits.",
    privateAnswerKey:
      "A limit describes the approached value as the input approaches a point.",
    workpad: "Pending",
  }
  const { client } = await provider([
    save(state),
    reply(state.privateAnswerKey),
  ])
  await expect(runTutorTurn(input, client, () => {})).rejects.toThrow(
    "private assessment key",
  )
})

test("bounds tool retries when a model repeatedly fails to save", async () => {
  const { client, requests } = await provider([])
  await expect(runTutorTurn(job(), client, () => {})).rejects.toThrow(
    "tool limit",
  )
  expect(requests).toHaveLength(16)
})

test("renders PDF diagrams with the bundled canvas and supplies the image to the model", async () => {
  const input = job()
  const directory = await mkdtemp(join(tmpdir(), "prune-pdf-"))
  directories.push(directory)
  input.assetDirectory = directory
  await copyFile(
    resolve("tests/fixtures/limits.pdf"),
    join(directory, "limits.pdf"),
  )
  const pdf = await getDocumentProxy(
    new Uint8Array(await readFile(join(directory, "limits.pdf"))),
  )
  let pages: string[]
  try {
    pages = (await extractText(pdf, { mergePages: false })).text
  } finally {
    await pdf.loadingTask.destroy()
  }
  const id = randomUUID()
  input.topic.materials.push({
    id,
    name: "limits.pdf",
    kind: "pdf",
    text: pages.join("\n\n"),
    pages,
  })
  const read: ChatCompletionMessage = {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [
      {
        id: "read",
        type: "function",
        function: {
          name: "read_material",
          arguments: JSON.stringify({
            id,
            firstPage: 1,
            lastPage: 1,
            includeVisuals: true,
          }),
        },
      },
    ],
  }
  const { client, requests } = await provider([
    read,
    save(input.topic.learning),
    reply("Please confirm the plan based on your slides."),
  ])
  await runTutorTurn(input, client, () => {})
  expect(requests[1]).toContain("Limits diagram")
  expect(requests[1]).toContain("data:image/png;base64,")
  expect(requests[1]).toContain(`prune-source://${id}/1`)
  const image = await readFile(join(directory, `source-${id}-1.png`))
  expect(image.subarray(1, 4).toString()).toBe("PNG")
})

test("OpenRouter title requests use the inexpensive model and bound the request", async () => {
  const mock = await provider([reply('"Introduction to Limits"')])
  const original = job()
  const input = {
    ...original,
    titleModel: ProviderModelSchema.parse({ id: "cheap-title-model", name: "Cheap title model" }),
  }
  expect(await generateTopicTitle(input, mock.client, () => {}, () => {})).toBe("Introduction to Limits")
  expect(JSON.parse(mock.requests[0])).toMatchObject({
    model: "cheap-title-model",
    max_tokens: 80,
    messages: [{ role: "system" }, { role: "user", content: "Teach me limits" }],
  })
  expect(input.runner.model).toBe("test")
  await expect(generateTopicTitle(original, mock.client, () => {}, () => {})).rejects.toThrow("No priced title model")
  expect(mock.requests).toHaveLength(1)
})
