import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { copyFile, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import { createCanvas } from "@napi-rs/canvas"
import OpenAI from "openai"
import type { ChatCompletionMessage } from "openai/resources/chat/completions"
import { afterEach, expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { topicMention } from "../src/shared/topic-mentions"
import { createTutorSession, runTutorTurn } from "../src/runners/tutor"
import { LearningStateSchema, ProviderModelSchema } from "../src/shared/contracts"
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
    if (z.object({ stream: z.boolean().optional() }).parse(JSON.parse(body)).stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      const send = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      send({ role: "assistant" })
      for (const [index, tool] of (message.tool_calls ?? []).entries()) {
        if (tool.type !== "function") continue
        send({ tool_calls: [{ index, id: tool.id, type: "function", function: { name: tool.function.name, arguments: "" } }] })
        for (const part of tool.function.arguments.match(/.{1,20}/gs) ?? [])
          send({ tool_calls: [{ index, function: { arguments: part } }] })
      }
      for (const part of message.content?.match(/.{1,8}/gs) ?? []) send({ content: part })
      send({}, message.tool_calls ? "tool_calls" : "stop")
      response.end("data: [DONE]\n\n")
      return
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
    provider: "codex" as const,
    model: "test",
  }
  const topic = newTopic("Limits")
  topic.learning.notes = `# Limits\n\n<topic-directory heading="Topic directory" items='[{"title":"1. Limits"}]' />`
  const chat = newChat(runner.id)
  chat.messages.push({
    id: randomUUID(),
    role: "user",
    content: `${topicMention(topic.id, topic.title)} Teach me limits`,
    createdAt: new Date().toISOString(),
    topicIds: [topic.id],
  })
  return {
    chat,
    topics: [{ ...topic, assetDirectory: resolve("tests") }],
    workspaceTopics: [],
    runner,
    apiKey: "test-only",
    skillDirectory: resolve("resources/tutor-me"),
    assetDirectory: resolve("tests"),
  } satisfies WorkerJob
}

test("draft curricula require sources and remain blocked from teaching until confirmed", async () => {
  const input = job()
  const topicId = "topic_1"
  const session = await createTutorSession(input, () => {})
  const part = { id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Explain approaching a value"] }, mistakes: [] }
  const rejected = await session.execute("updateTopic", { topicId, content: [part] })
  expect(rejected.success).toBe(false)
  expect(rejected.text).toContain("source")
  expect((await session.execute("createTopic", { topic: { version: "11-10-2026", name: "Limits", content: [part] } })).success).toBe(false)
  const sourced = { ...part, references: [{ type: "website", url: "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function" }] }
  expect((await session.execute("updateTopic", { topicId, content: [sourced] })).success).toBe(true)
  const teaching = await session.execute("activatePart", { topicId, topicPartId: part.id })
  expect(teaching.success).toBe(false)
  expect(teaching.text).toContain("confirm")
})


test("attached screenshots reach ChatGPT as pixels on the first request without a material tool call", async () => {
  const input = job()
  const directory = await mkdtemp(join(tmpdir(), "edu-message-image-"))
  directories.push(directory)
  input.assetDirectory = directory
  const material = { id: randomUUID(), name: "screenshot.png", kind: "image" as const, text: "Image source. Use read_material to inspect the image visually.", pages: [] }
  await writeFile(join(directory, material.name), createCanvas(80, 40).toBuffer("image/png"))
  input.chat.materials.push(material)
  input.chat.messages[0].materialIds = [material.id]
  const { client, requests } = await provider([save(input.chat.learning), reply("The screenshot appears to show a diagram.")])
  await runTutorTurn(input, client, () => {})
  const request = z.object({ messages: z.array(z.object({ role: z.string(), content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional(), image_url: z.object({ url: z.string() }).optional() }))]) })) }).parse(JSON.parse(requests[0]))
  const user = request.messages.find((message) => message.role === "user")
  if (!user || typeof user.content === "string") throw new Error("Screenshot pixels were omitted from the user message")
  expect(user.content.some((part) => part.image_url?.url.startsWith("data:image/png;base64,"))).toBe(true)
  expect(user.content.some((part) => part.text?.includes(`prune-source://${material.id}/1`))).toBe(true)
})

test("historical images outside the active topic context do not block later ChatGPT turns", async () => {
  const input = job()
  input.chat.messages[0].materialIds = [randomUUID()]
  input.chat.messages.push({ id: randomUUID(), role: "user", content: "Continue with the current topic.", topicIds: [], createdAt: new Date().toISOString() })
  const { client } = await provider([save(input.chat.learning), reply("Here is the current topic plan.")])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.reply).toBe("Here is the current topic plan.")
})

test("an unavailable current screenshot is reported instead of silently omitted", async () => {
  const input = job()
  input.chat.messages[0].materialIds = [randomUUID()]
  const { client } = await provider([])
  await expect(runTutorTurn(input, client, () => {})).rejects.toThrow("attached image is not available")
})
function call(name: string, input: object): ChatCompletionMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [
      {
        id: randomUUID(),
        type: "function",
        function: { name, arguments: JSON.stringify(input) },
      },
    ],
  }
}
function save(state: LearningState) {
  return call("save_learning_state", state)
}
function reply(content: string): ChatCompletionMessage {
  return { role: "assistant", content, refusal: null }
}

test("tutor sessions expose the shared visualization contract alongside existing source and assessment guidance", async () => {
  const session = await createTutorSession(job(), () => {})
  expect(session.instructions).toContain("<visualization settings='")
  expect(session.instructions).toContain('"type":"surface"')
  expect(session.instructions).toContain("matrices, transformations, trends")
  expect(session.instructions).toContain("saved conceptual topic summaries")
  expect(session.instructions).toContain("Distinguish illustrative data")
  expect(session.instructions).toContain("Keep answer keys private")
})

test("the tutor receives the currently open topic and saved next action alongside older chat topics", async () => {
  const input = job()
  const topic = newTopic("Automata")
  topic.learning.nextAction = "Discuss deterministic finite automata."
  const session = await createTutorSession({
    ...input,
    openedTopicId: topic.id,
    topics: [...input.topics, { ...topic, assetDirectory: resolve("tests") }],
  }, () => {})
  expect(session.instructions).toContain("Currently open topic: topic_2")
  expect(session.instructions).not.toContain(topic.learning.nextAction)
  expect(session.instructions).toContain("Explicit topic mentions or instructions take precedence")
  const withoutOpenTopic = await createTutorSession(input, () => {})
  expect(withoutOpenTopic.instructions).toContain("Currently open topic: none")
})

test("handoff tool advertises nonempty fields before the provider attempts a save", async () => {
  const session = await createTutorSession(job(), () => {})
  const tool = session.tools.find((tool) => tool.type === "function" && tool.function.name === "save_learning_state")
  if (!tool || tool.type !== "function") throw new Error("Missing handoff tool")
  const schema = z.object({ properties: z.object({
    workpad: z.object({ minLength: z.number(), pattern: z.string() }),
    nextAction: z.object({ minLength: z.number(), pattern: z.string() }),
  }) }).parse(tool.function.parameters)
  expect(schema.properties.workpad.minLength).toBe(1)
  expect(schema.properties.nextAction.minLength).toBe(1)
  expect(schema.properties.workpad.pattern).toBe("\\S")
  expect(schema.properties.nextAction.pattern).toBe("\\S")
  const valid = { ...job().chat.learning, workpad: "No pending question; waiting for plan confirmation." }
  for (const field of ["workpad", "nextAction"]) {
    expect((await session.execute("save_learning_state", { ...valid, [field]: "   " })).success).toBe(false)
  }
  expect((await session.execute("save_learning_state", valid)).success).toBe(true)
  expect(LearningStateSchema.safeParse({ ...valid, workpad: "", nextAction: "" }).success).toBe(true)
})

test("initial topic status includes other-thread continuations without registering this chat", async () => {
  const input = job()
  const topic = input.topics[0]
  topic.state = {
    version: "11-10-2026", createdAt: topic.createdAt, name: topic.title,
    content: [{ id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Explain a limit"] }, mistakes: [] }],
    threadTutors: [{ id: "another-chat", progress: { "tp-limits": { status: "active", steps: [{ question: "What is a limit?", answerFromUser: "Historical answer must not be repeated in the status snapshot." }] } } }],
  }
  const session = await createTutorSession(input, () => {})
  const line = session.instructions.split("\n").find((line) => line.startsWith("Initial topic status: "))
  expect(line).toBeDefined()
  expect(line).not.toContain("Historical answer must not be repeated")
  const status = z.array(z.object({ topicId: z.string(), whereAmI: z.array(z.json()), topicProgress: z.array(z.json()), whatIsNext: z.array(z.json()) }))
    .parse(JSON.parse(line!.slice("Initial topic status: ".length)))
  expect(status).toEqual([{ topicId: "topic_1", whereAmI: [], topicProgress: [{ topicPartId: "tp-limits", name: "Limits", threads: [{ threadId: "another-chat", status: "active" }] }], whatIsNext: [{ label: "Continue from What is a limit?", threadId: "another-chat", topicPartId: "tp-limits", name: "Limits", status: "active" }] }])
  await session.execute("save_learning_state", { ...input.chat.learning, workpad: "Waiting for a continuation choice." })
  expect(session.finish("Choose a continuation").topicMutations).toEqual([])
})

test("requires a valid saved handoff before returning a learner reply", async () => {
  const input = job()
  const state = {
    ...input.chat.learning,
    workpad: "Proposed a plan for Limits.",
  }
  const { client, requests } = await provider([
    reply("Unsaved plan"),
    save(state),
    reply("Review this plan before we begin."),
  ])
  const nodes: string[] = []
  const result = await runTutorTurn(input, client, () => {}, (event, details) => {
    if (event === "graph.node" && typeof details.node === "string") nodes.push(details.node)
  })
  expect(nodes).toContain("recover")
  expect(nodes).toContain("tools")
  expect(nodes.at(-1)).toBe("finish")
  expect(result.learning).toEqual(state)
  expect(result.topicUpdates).toEqual([])
  expect(requests).toHaveLength(3)
  expect(requests[0]).toContain("topic_1")
  expect(requests[1]).toContain("Save the complete learning state")
})

test("prevents an unconfirmed structured topic from advancing to teaching", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const result = await session.execute("activatePart", { topicId: "topic_1", topicPartId: "tp-limits" })
  expect(result.success).toBe(false)
  expect(result.text).toContain("Wait for the learner to confirm")
})

test("conceptual summary updates use structured tools without writing legacy topic handoffs", async () => {
  const input = job()
  const { client } = await provider([
    call("updateTopic", { topicId: "topic_1", summary: "A limit describes an approached value." }),
    save(input.chat.learning), reply("Here is the conceptual summary."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.topicMutations).toMatchObject([{ type: "updateTopic", topicId: input.topics[0].id, summary: "A limit describes an approached value." }])
})

test("updateTopic accepts attached lecture code as a structured text reference", async () => {
  const input = job()
  const material = { id: randomUUID(), name: "Lecture 4 - Code used in lecture.txt", kind: "text" as const, text: "int main() { return 0; }", pages: [] }
  input.chat.materials.push(material)
  const session = await createTutorSession(input, () => {})
  const result = await session.execute("updateTopic", {
    topicId: "topic_1",
    materialIds: [material.id],
    content: [{
      id: "tp-4a", name: "4A. Code walkthrough",
      references: [{ type: "text", path: "assets/Lecture 4 - Code used in lecture.txt" }],
      goals: { id: "tpg-4a", objective: "Explain the lecture code", understoodWhen: ["Trace the program"] },
      mistakes: [],
    }],
  })
  expect(result).toMatchObject({ success: true })
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.finish("Added the code source.").topicMutations).toMatchObject([{
    type: "updateTopic", materialIds: [material.id],
    content: [{ references: [{ type: "text", path: "assets/Lecture 4 - Code used in lecture.txt" }] }],
  }])
})

test("rejected structured topic writes block publication until the same operation is repaired", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const topicId = "topic_1"
  await session.execute("updateTopic", { topicId, content: [{ id: "broken" }] })
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.saved).toBe(false)
  expect(session.saveError).toContain(`updateTopic:${topicId}`)
  expect(session.saveError).toContain("save_learning_state cannot repair")
  expect(() => session.finish("Saved.")).toThrow()
  await session.execute("updateTopic", { topicId, summary: "Conceptual summary." })
  expect(session.saved).toBe(true)
})

test("a corrected question target repairs a rejected nonexistent topic ID", async () => {
  const input = job()
  input.topics[0].planConfirmed = true
  const topicId = "topic_1"
  const session = await createTutorSession(input, () => {})
  await session.execute("updateTopic", { topicId, content: [{
    id: "tp-limits", name: "Limits", references: [],
    goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Distinguish limit from function value"] },
    mistakes: [],
  }] })
  await session.execute("activatePart", { topicId, topicPartId: "tp-limits" })
  const question = { topicId: randomUUID(), topicPartId: "tp-limits", question: "Can a limit exist where the function is undefined?" }
  const rejected = await session.execute("recordQuestion", question)
  expect(rejected.success).toBe(false)
  expect(rejected.text).toContain("Allowed write targets: topic_1")
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.saved).toBe(false)
  expect(() => session.finish("Premature reply")).toThrow()
  expect((await session.execute("recordQuestion", { ...question, topicId })).success).toBe(true)
  expect(session.saved).toBe(true)
  expect(session.finish(question.question).topicMutations.filter((mutation) => mutation.type === "recordQuestion"))
    .toEqual([{ type: "recordQuestion", topicId: input.topics[0].id, topicPartId: "tp-limits", question: question.question }])
})

test("only tagged topics can be updated", async () => {
  const input = job()
  const untagged = newTopic("Integrals")
  const { client, requests } = await provider([
    call("whereAmI", { topicId: untagged.id }),
    save(input.chat.learning),
    reply("Tag Integrals to plan it."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.topicUpdates).toEqual([])
  expect(requests[1]).toContain("Allowed read targets: topic_1")
})

test("a rejected replacement save cannot publish an older staged state", async () => {
  const input = job()
  const valid = { ...input.chat.learning, workpad: "Planned limits." }
  const invalid = { ...valid, workpad: "" }
  const corrected = { ...valid, workpad: "Revised the limits plan." }
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

test("resumes a tagged topic's pending question and withholds the checked key from visible output", async () => {
  const input = job()
  const topic = input.topics[0]
  topic.planConfirmed = true
  const state = {
    ...topic.learning,
    phase: "awaiting_answer" as const,
    pendingQuestion: "Explain what a limit describes.",
    privateAnswerKey:
      "A limit describes the approached value as the input approaches a point.",
    workpad: "Pending Check; no learner attempt.",
  }
  input.chat.learning = state
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
  const topic = input.topics[0]
  topic.planConfirmed = true
  const state = {
    ...topic.learning,
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
  const updates: string[] = []
  await expect(runTutorTurn(input, client, () => {}, undefined, undefined, (text) => updates.push(text))).rejects.toThrow(
    "private assessment key",
  )
  expect(updates.every((text) => text === "")).toBe(true)
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
  const topic = input.topics[0]
  topic.assetDirectory = directory
  await copyFile(
    resolve("tests/fixtures/diagram.pdf"),
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
  topic.materials.push({
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
    save(input.chat.learning),
    reply("Please confirm the plan based on your slides."),
  ])
  await runTutorTurn(input, client, () => {})
  expect(requests[1]).toContain("Limits diagram")
  expect(requests[1]).toContain("data:image/png;base64,")
  expect(requests[1]).toContain(`prune-source://${id}/1`)
  const image = await readFile(join(directory, `source-${id}-1.png`))
  expect(image.subarray(1, 4).toString()).toBe("PNG")
})


test("structured mistakes preserve exact original answers across follow-up attempts", async () => {
  const input = job()
  input.topics[0].planConfirmed = true
  const session = await createTutorSession(input, () => {})
  const topicId = "topic_1"
  const content = [{ id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Distinguish approaching from reaching"] }, mistakes: [] }]
  await session.execute("updateTopic", { topicId, content })
  await session.execute("activatePart", { topicId, topicPartId: "tp-limits" })
  await session.execute("recordQuestion", { topicId, topicPartId: "tp-limits", question: "Must the value be reached?" })
  await session.execute("recordAnswer", { topicId, topicPartId: "tp-limits", stepIndex: 0, answerFromUser: "Yes, it must be reached." })
  await session.execute("documentMistake", { topicId, topicPartId: "tp-limits", context: "Must the value be reached? Yes, it must be reached.", issue: "Confuses approaching with reaching." })
  await session.execute("recordQuestion", { topicId, topicPartId: "tp-limits", question: "Can an absent point still have a limit?" })
  await session.execute("recordAnswer", { topicId, topicPartId: "tp-limits", stepIndex: 1, answerFromUser: "Yes; the approached value is enough." })
  const result = await session.execute("getQuestions", { topicId, topicPartId: "tp-limits" })
  expect(JSON.parse(result.text)).toMatchObject([
    { question: "Must the value be reached?", answerFromUser: "Yes, it must be reached." },
    { question: "Can an absent point still have a limit?", answerFromUser: "Yes; the approached value is enough." },
  ])
  const mistakes = await session.execute("getMistakesForTopic", { topics: [topicId] })
  expect(JSON.parse(mistakes.text)).toMatchObject([{ context: "Must the value be reached? Yes, it must be reached.", issue: "Confuses approaching with reaching." }])
})

test("unknown structured parts cannot silently publish a prior staged state", async () => {
  const input = job()
  input.topics[0].planConfirmed = true
  const session = await createTutorSession(input, () => {})
  await session.execute("save_learning_state", input.chat.learning)
  await session.execute("activatePart", { topicId: "topic_1", topicPartId: "tp-missing" })
  expect(session.saved).toBe(false)
  expect(() => session.finish("Saved.")).toThrow("Topic part not found")
})

test("the tutor exposes cross-thread coverage separately from mastery and retains it in staged writes", async () => {
  const input = job()
  const topic = input.topics[0]
  topic.planConfirmed = true
  const session = await createTutorSession(input, () => {})
  expect(session.instructions).toContain("For a topic status question")
  const content = [{ id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Justify reasoning"] }, mistakes: [] }]
  await session.execute("updateTopic", { topicId: "topic_1", content })
  await session.execute("activatePart", { topicId: "topic_1", topicPartId: "tp-limits" })
  expect((await session.execute("complete", { topicId: "topic_1", topicPartId: "tp-limits", masteryVerified: false })).success).toBe(true)
  const progress = await session.execute("getTopicProgress", { topicId: "topic_1" })
  expect(progress.success).toBe(true)
  expect(JSON.parse(progress.text)).toMatchObject([{ part: { id: "tp-limits" }, threads: [{ threadId: input.chat.id, progress: { status: "covered" } }] }])
  expect(JSON.parse((await session.execute("whatIsNext", { topicId: "topic_1" })).text)).toEqual([])
  await session.execute("save_learning_state", input.chat.learning)
  const result = session.finish("Walkthrough finished; mastery unverified.")
  expect(result.topicMutations).toContainEqual({ type: "complete", topicId: topic.id, topicPartId: "tp-limits", masteryVerified: false })
})

test("legacy topic state writers are no longer exposed or accepted", async () => {
  const session = await createTutorSession(job(), () => {})
  for (const name of ["save_topic_state", "revise_topic_state"]) {
    expect(session.tools.some((tool) => tool.type === "function" && tool.function.name === name)).toBe(false)
    expect((await session.execute(name, {})).success).toBe(false)
  }
})

test("rejects invented directory source paths before publishing topic notes", async () => {
  const input = job()
  const topic = input.topics[0]
  topic.materials.push({ id: randomUUID(), name: "Lecture 11 - Datapath.pdf", kind: "pdf", text: "Datapath", pages: ["Datapath"] })
  const session = await createTutorSession(input, () => {})
  const notes = '# Limits\n\n<topic-directory heading="Topic directory" items=\'[{"title":"1. Limits","sources":[{"label":"Lecture 11.pdf, pg. 1","href":"assets/invented.pdf#page=1"}]}]\' />'
  const rejected = await session.execute("updateTopic", { topicId: "topic_1", summary: notes })
  expect(rejected.success).toBe(false)
  expect(rejected.text).toContain("invented.pdf")
  const repaired = await session.execute("updateTopic", { topicId: "topic_1", summary: notes.replace("invented.pdf", "Lecture 11 - Datapath.pdf") })
  expect(repaired.success).toBe(true)
})

test.each(["awaiting_clarification", "contested"] as const)("preserves pending assessment boundaries in phase %s", async (phase) => {
  const input = job()
  const topic = input.topics[0]
  topic.planConfirmed = true
  const key = "A limit describes the approached value as the input approaches a point."
  input.chat.learning = LearningStateSchema.parse({ ...input.chat.learning, phase, pendingQuestion: "Explain limits.", privateAnswerKey: key })
  const session = await createTutorSession(input, () => {})
  await session.execute("save_learning_state", input.chat.learning)
  expect(() => session.finish(key)).toThrow("private assessment key")
  expect(() => LearningStateSchema.parse({ ...input.chat.learning, pendingQuestion: "" })).toThrow("active question")
})

test("source images reuse unchanged renders and rebuild corrupt or outdated caches", async () => {
  const input = job()
  const directory = await mkdtemp(join(tmpdir(), "edu-source-cache-"))
  directories.push(directory)
  const source = join(directory, "limits.pdf")
  await copyFile(resolve("tests/fixtures/diagram.pdf"), source)
  const topic = input.topics[0]
  topic.assetDirectory = directory
  const id = randomUUID()
  topic.materials.push({ id, name: "limits.pdf", kind: "pdf", text: "Limits diagram", pages: ["Limits diagram"] })
  const session = await createTutorSession(input, () => {})
  const request = { id, firstPage: 1, lastPage: 1, includeVisuals: true }
  expect((await session.execute("read_material", request)).success).toBe(true)
  const cache = join(directory, `source-${id}-1.png`)
  const timestamp = (await stat(cache)).mtimeMs
  expect((await session.execute("read_material", request)).images).toHaveLength(2)
  expect((await stat(cache)).mtimeMs).toBe(timestamp)
  await writeFile(cache, "interrupted PNG")
  expect((await session.execute("read_material", request)).success).toBe(true)
  expect((await readFile(cache)).subarray(1, 4).toString()).toBe("PNG")
  const originalTime = (await stat(source)).mtime
  await utimes(cache, new Date(0), new Date(0))
  expect((await session.execute("read_material", request)).success).toBe(true)
  expect((await stat(cache)).mtimeMs).toBeGreaterThanOrEqual(originalTime.getTime())
})

test("pages workspace topic history completely and rejects invalid retrieval requests", async () => {
  const input = job()
  const topic = newTopic("Archived physics")
  topic.archived = true
  const notes = "Historical learner attempt. ".repeat(900) + "Resolved mistake at the end."
  const session = await createTutorSession({ ...input, workspaceTopics: [{ id: topic.id, title: topic.title, archived: true, notes }] }, () => {})
  const PageSchema = z.object({ notes: z.string(), nextOffset: z.number().nullable(), totalCharacters: z.number() })
  const first = await session.execute("read_topic_notes", { topicId: "topic_2" })
  expect(first.success).toBe(true)
  const page = PageSchema.parse(JSON.parse(first.text))
  expect(page.notes).toHaveLength(20_000)
  expect(page.nextOffset).toBe(20_000)
  expect(page.totalCharacters).toBe(notes.length)
  const next = await session.execute("read_topic_notes", { topicId: "topic_2", offset: page.nextOffset })
  const tail = PageSchema.parse(JSON.parse(next.text))
  expect(tail.nextOffset).toBe(null)
  expect(page.notes + tail.notes).toBe(notes)
  for (const request of [
    { topicId: randomUUID() },
    { topicId: "topic_2", offset: notes.length + 1 },
    { topicId: "topic_2", offset: -1 },
    { topicId: "topic_2", limit: 20_001 },
  ]) {
    expect((await session.execute("read_topic_notes", request)).success).toBe(false)
  }
})

test("does not expose or accept the removed behaviour memory tool", async () => {
  const session = await createTutorSession(job(), () => {})
  expect(session.tools.map((tool) => tool.type === "function" && tool.function.name)).not.toContain("save_behaviour_memory")
  expect(session.instructions).not.toContain("behaviour.md")
  expect((await session.execute("save_behaviour_memory", { expected: "", content: "Old preference" })).success).toBe(false)
  await session.execute("save_learning_state", job().chat.learning)
  expect(session.finish("Feedback applied.")).not.toHaveProperty("behaviourUpdate")
})

test("structured tools scope writers to the current thread, keep references read-only, and emit replayable mutations", async () => {
  const input = job()
  input.topics[0].planConfirmed = true
  const session = await createTutorSession(input, () => {})
  const topicId = "topic_1"
  const content = [{ id: "tp-limits", name: "Limits", references: [], goals: { id: "tpg-limits", objective: "Explain limits", understoodWhen: ["Distinguish limit from function value"] }, mistakes: [] }]
  expect((await session.execute("updateTopic", { topicId, content })).success).toBe(true)
  expect((await session.execute("activatePart", { topicId, topicPartId: "tp-limits", threadId: "someone-else" })).success).toBe(false)
  expect((await session.execute("activatePart", { topicId, topicPartId: "tp-limits", threadId: input.chat.id })).success).toBe(true)
  expect((await session.execute("recordQuestion", { topicId, topicPartId: "tp-limits", question: "Does a limit have to equal f(a)?" })).success).toBe(true)
  const questions = await session.execute("getQuestions", { topicId, topicPartId: "tp-limits" })
  expect(JSON.parse(questions.text)).toEqual([{ threadId: input.chat.id, stepIndex: 0, question: "Does a limit have to equal f(a)?" }])
  expect((await session.execute("save_learning_state", input.chat.learning)).success).toBe(true)
  const result = session.finish("Does a limit have to equal f(a)?")
  expect(result.topicMutations.map((operation) => operation.type)).toEqual(["updateTopic", "activatePart", "recordQuestion"])
  expect(result.topicUpdates).toEqual([])
})

test("fresh progress ignores legacy pending topic handoffs and new-topic writes register their creator", async () => {
  const input = job()
  input.topics[0].learning.pendingQuestion = "Legacy pending question"
  input.topics[0].learning.privateAnswerKey = "Legacy secret answer"
  const session = await createTutorSession(input, () => {})
  const location = await session.execute("whereAmI", { topicId: "topic_1", threadId: input.chat.id })
  expect(JSON.parse(location.text)).toEqual([])
  expect(session.instructions).not.toContain("Legacy pending question")
  expect(session.instructions).not.toContain("Legacy secret answer")
  const created = await session.execute("createTopic", { topic: { version: "11-10-2026", name: "Prerequisite", content: [] }, threadId: input.chat.id })
  expect(created.success).toBe(true)
  const { topicId } = z.object({ topicId: z.literal("topic_2") }).parse(JSON.parse(created.text))
  await session.execute("save_learning_state", input.chat.learning)
  expect(topicId).toBe("topic_2")
  expect(session.finish("Created the requested prerequisite.").topicMutations[0]).toMatchObject({ type: "createTopic", topicId: expect.any(String) })
})

test("summary citations resolve a source shared by the chat and topic", async () => {
  const input = job()
  const material = { id: randomUUID(), name: "Lecture 11.pdf", kind: "pdf" as const, text: "Datapath", pages: ["Datapath"] }
  input.chat.materials.push(material)
  input.topics[0].materials.push(material)
  const session = await createTutorSession(input, () => {})
  const summary = `# Limits\n\n<topic-directory heading="Topic directory" items='[{"title":"Limits","sources":[{"label":"Lecture 11.pdf, pg. 1","href":"assets/Lecture 11.pdf#page=1"}]}]' />\n\n## Limits\n\nA limit is an approached value.`
  const result = await session.execute("updateTopic", { topicId: "topic_1", summary })
  expect(result.success).toBe(true)
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.finish("Updated the explanation.").topicMutations).toMatchObject([{ type: "updateTopic", summary }])
})

test("streams partial replies and reconstructs fragmented tool calls before completion", async () => {
  const input = job()
  const state = { ...input.chat.learning, workpad: "Plan saved." }
  const { client } = await provider([save(state), reply("Review this plan before we begin.")])
  const updates: string[] = []
  let completed = false
  const result = await runTutorTurn(input, client, () => {}, undefined, undefined, (text: string) => {
    expect(completed).toBe(false)
    updates.push(text)
  })
  completed = true
  expect(updates).toContain("Review t")
  expect(updates.at(-1)).toBe("Review this plan before we begin.")
  expect(result.reply).toBe("Review this plan before we begin.")
  expect(result.learning.workpad).toBe("Plan saved.")
})

test.each(["awaiting_answer", "awaiting_clarification", "contested"] as const)(
  "streams explanations during %s without exposing a fragmented private key",
  async (phase) => {
    const input = job()
    const state = {
      ...input.chat.learning,
      phase,
      pendingQuestion: "Evaluate the integral.",
      privateAnswerKey: "The checked integral is minus nine halves.",
      workpad: "Waiting for the learner's answer.",
    }
    const explanation = "Here is a sketch of the function."
    const { client } = await provider([save(state), reply(explanation)])
    const updates: string[] = []
    const result = await runTutorTurn(input, client, () => {}, undefined, undefined, (text) => updates.push(text))
    expect(updates).toContain("Here is ")
    expect(updates.at(-1)).toBe(explanation)
    expect(result.reply).toBe(explanation)

    const session = await createTutorSession(input, () => {})
    expect(session.previewReply(explanation)).toBe("")
    expect((await session.execute("save_learning_state", state)).success).toBe(true)
    for (let length = 1; length <= state.privateAnswerKey.length; length++) {
      const partial = `${explanation} ${state.privateAnswerKey.slice(0, length)}`
      expect(session.previewReply(partial)).toBe(`${explanation} `)
    }
    expect(session.previewReply(`${explanation} ${state.privateAnswerKey} More text.`)).toBe(`${explanation} `)
    expect(() => session.finish(`${explanation} ${state.privateAnswerKey}`)).toThrow("private assessment key")
    expect(session.previewReply(`${explanation} The curve crosses the axis.`)).toBe(`${explanation} The curve crosses the axis.`)

    await session.execute("save_learning_state", { ...state, workpad: "" })
    expect(session.previewReply(explanation)).toBe("")
  },
)

test("accepts optional response choices and rejects ambiguous or incomplete options", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const state = { ...input.chat.learning, phase: "awaiting_choice", workpad: "Waiting for the learner's choice." }
  for (const options of [["Continue"], ["Continue", "Continue"], ["Continue", "   "]]) {
    expect((await session.execute("save_learning_state", {
      ...state, responseQuestion: { prompt: "What next?", options },
    })).success).toBe(false)
  }
  const responseQuestion = { prompt: "What next?", options: ["Continue", "Quick practice"] }
  expect((await session.execute("save_learning_state", { ...state, responseQuestion })).success).toBe(true)
  expect(session.finish("Your summary meets the goals.").learning).toMatchObject({ responseQuestion })
  expect((await session.execute("save_learning_state", state)).success).toBe(true)
  expect(session.finish("We can continue.").learning).not.toHaveProperty("responseQuestion")
})

test.each(["prompt", "option"])("keeps a checked key out of the response choice %s", async (field) => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const privateAnswerKey = "A limit concerns nearby values rather than the function value at the point."
  const responseQuestion = { prompt: "What next?", options: ["Continue", "Quick practice"] }
  if (field === "prompt") responseQuestion.prompt = privateAnswerKey
  else responseQuestion.options[0] = privateAnswerKey
  await session.execute("save_learning_state", {
    ...input.chat.learning, phase: "awaiting_answer", workpad: "Waiting for the learner's reasoning.",
    pendingQuestion: "Why can a limit exist where the function is undefined?", privateAnswerKey, responseQuestion,
  })
  expect(() => session.finish("Consider the nearby values.")).toThrow("private assessment key")
})

test("preserves response prompts and options in reconstructed model history", async () => {
  const input = job()
  input.chat.messages.unshift({
    id: randomUUID(), role: "assistant", createdAt: new Date().toISOString(), topicIds: [],
    content: "The part's goals are satisfied.",
    responseQuestion: { prompt: "Choose what happens after this part.", options: ["Continue to functions", "Quick practice on pointers"] },
  })
  const { client, requests } = await provider([save(input.chat.learning), reply("Continuing.")])
  await runTutorTurn(input, client, () => {})
  const request = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(requests[0]))
  expect(request.messages.find((message) => message.role === "assistant")?.content).toBe(
    "The part's goals are satisfied.\n\nChoose what happens after this part.\n- Continue to functions\n- Quick practice on pointers",
  )
})
