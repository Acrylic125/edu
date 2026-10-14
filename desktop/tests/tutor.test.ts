import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { copyFile, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import OpenAI from "openai"
import type { ChatCompletionMessage } from "openai/resources/chat/completions"
import { afterEach, expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { topicMention } from "../src/shared/topic-mentions"
import { createTutorSession, runTutorTurn } from "../src/runners/tutor"
import { generateTopicTitle } from "../src/runners/title"
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
    runner,
    apiKey: "test-only",
    skillDirectory: resolve("resources/tutor-me"),
    assetDirectory: resolve("tests"),
  } satisfies WorkerJob
}
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
function saveTopic(topicId: string, learning: LearningState) {
  return call("save_topic_state", { topicId, learning })
}
function reply(content: string): ChatCompletionMessage {
  return { role: "assistant", content, refusal: null }
}

test("the tutor receives the currently open topic and saved next action alongside older chat topics", async () => {
  const input = job()
  const topic = newTopic("Automata")
  topic.learning.nextAction = "Discuss deterministic finite automata."
  const session = await createTutorSession({
    ...input,
    openedTopicId: topic.id,
    topics: [...input.topics, { ...topic, assetDirectory: resolve("tests") }],
  }, () => {})
  expect(session.instructions).toContain(`Currently open topic: ${topic.id}`)
  expect(session.instructions).toContain(topic.learning.nextAction)
  expect(session.instructions).toContain("Explicit topic mentions or instructions take precedence")
  const withoutOpenTopic = await createTutorSession(input, () => {})
  expect(withoutOpenTopic.instructions).toContain("Currently open topic: none")
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
  const result = await runTutorTurn(input, client, () => {})
  expect(result.learning).toEqual(state)
  expect(result.topicUpdates).toEqual([])
  expect(requests).toHaveLength(3)
  expect(requests[0]).toContain(input.topics[0].id)
  expect(requests[1]).toContain("Save the complete learning state")
})

test("prevents a tagged topic's unconfirmed plan from advancing to teaching", async () => {
  const input = job()
  const topic = input.topics[0]
  const invalid = {
    ...topic.learning,
    phase: "ready_to_continue" as const,
    notes: "Taught limits",
    workpad: "Skip confirmation",
  }
  const corrected = {
    ...topic.learning,
    outline: ["Limits"],
    workpad: "Wait for confirmation",
  }
  const { client, requests } = await provider([
    saveTopic(topic.id, invalid),
    saveTopic(topic.id, corrected),
    save(input.chat.learning),
    reply("Please confirm this plan."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.topicUpdates).toEqual([
    { topicId: topic.id, learning: corrected, expected: topic.learning },
  ])
  expect(requests[1]).toContain("Wait for the learner to confirm")
})

test("topic notes must render their directory as a topic-directory element", async () => {
  const input = job()
  const topic = input.topics[0]
  const markdown = {
    ...topic.learning,
    outline: ["Limits"],
    notes: "# Limits\n\n## Topic directory\n\n- 1. Limits",
    workpad: "Wait for confirmation",
  }
  const { client, requests } = await provider([
    saveTopic(topic.id, markdown),
    saveTopic(topic.id, { ...markdown, notes: topic.learning.notes }),
    save(input.chat.learning),
    reply("Please confirm this plan."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.topicUpdates).toEqual([
    { topicId: topic.id, learning: { ...markdown, notes: topic.learning.notes }, expected: topic.learning },
  ])
  expect(requests[0]).toContain("<topic-directory heading=")
  expect(requests[1]).toContain("one <topic-directory /> element")
})

test("recovery identifies the rejected topic save instead of only requesting a chat handoff", async () => {
  const input = job()
  const topic = input.topics[0]
  const session = await createTutorSession(input, () => {})
  await session.execute("save_topic_state", {
    topicId: topic.id,
    learning: { ...topic.learning, notes: "# Limits", outline: ["Limits"] },
  })
  await session.execute("save_learning_state", input.chat.learning)
  expect(session.saved).toBe(false)
  expect(session.saveError).toContain(`save_topic_state for topic ${topic.id}`)
  expect(session.saveError).toContain("save_learning_state cannot repair")
})

test("only tagged topics can be updated", async () => {
  const input = job()
  const untagged = newTopic("Integrals")
  const { client, requests } = await provider([
    saveTopic(untagged.id, { ...untagged.learning, outline: ["Integrals"] }),
    save(input.chat.learning),
    reply("Tag Integrals to plan it."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(result.topicUpdates).toEqual([])
  expect(requests[1]).toContain("Only tagged topics can be saved")
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
  topic.learning = state
  const { client, requests } = await provider([
    saveTopic(topic.id, state),
    save(input.chat.learning),
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
    saveTopic(topic.id, state),
    save(input.chat.learning),
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

test("OpenRouter title requests use the inexpensive model and bound the request", async () => {
  const mock = await provider([reply('"Introduction to Limits"')])
  const original = job()
  const input = {
    ...original,
    titleModel: ProviderModelSchema.parse({ id: "cheap-title-model", name: "Cheap title model" }),
  }
  expect(await generateTopicTitle(input, input.chat.messages.find((message) => message.role === "user")?.content ?? "", mock.client, () => {}, () => {})).toBe("Introduction to Limits")
  expect(JSON.parse(mock.requests[0])).toMatchObject({
    model: "cheap-title-model",
    max_tokens: 80,
    messages: [{ role: "system" }, { role: "user", content: "@Limits Teach me limits" }],
  })
  expect(input.runner.model).toBe("test")
  await expect(generateTopicTitle(original, original.chat.messages.find((message) => message.role === "user")?.content ?? "", mock.client, () => {}, () => {})).rejects.toThrow("No priced title model")
  expect(mock.requests).toHaveLength(1)
})

test("loads workspace behaviour memory and stages explicit feedback with the original revision", async () => {
  const input = { ...job(), behaviourMemory: "# Tutor preferences\n\nUse the lecture's own examples." }
  const revised = input.behaviourMemory + "\nExplain in smaller steps."
  const final = revised + "\nAsk one question at a time."
  const { client, requests } = await provider([
    call("save_behaviour_memory", { expected: input.behaviourMemory, content: revised }),
    call("save_behaviour_memory", { expected: revised, content: final }),
    save(input.chat.learning),
    reply("I’ll explain in smaller steps and ask one question at a time."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  const session = await createTutorSession(input, () => {})
  expect(session.instructions).toContain(JSON.stringify(input.behaviourMemory))
  expect(requests).toHaveLength(4)
  expect(result.behaviourUpdate).toEqual({ expected: input.behaviourMemory, content: final })
  expect(input.behaviourMemory).not.toContain("smaller steps")
})

test("rejected preference saves must be corrected before publishing a reply", async () => {
  const input = { ...job(), behaviourMemory: "Existing preferences" }
  const { client, requests } = await provider([
    call("save_behaviour_memory", { expected: "stale preferences", content: "Overwritten" }),
    save(input.chat.learning),
    reply("I saved your preferences."),
    call("save_behaviour_memory", { expected: input.behaviourMemory, content: "Existing preferences\nUse smaller steps." }),
    reply("I’ll use smaller steps."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(requests[3]).toContain("Correct rejected saves first")
  expect(result.reply).toBe("I’ll use smaller steps.")
  expect(result.behaviourUpdate?.content).toBe("Existing preferences\nUse smaller steps.")
})

test("bounded difficulty revisions preserve original attempts and merge repeated evidence", async () => {
  const input = job()
  const topic = input.topics[0]
  topic.planConfirmed = true
  const attempt = "### Check C1\nQuestion: Explain limits.\nLearner answer: The function must reach the limit."
  const difficulty = "### Current difficulties\nD1: unresolved — Confuses approaching with reaching. Evidence: C1."
  topic.learning.notes += `\n\n## Limits\n\n${attempt}\n\n${difficulty}\n\n## Materials\n\nOriginal lecture assets.`
  const updated = "### Current difficulties\nD1: improving — Independently distinguishes approaching from reaching in C2; broader understanding unassessed. Evidence: C1, C2."
  const fresh = "### Check C2\nQuestion: Can a limit exist without reaching the value?\nLearner answer: Yes; approaching is enough."
  const { client } = await provider([
    call("revise_topic_state", {
      topicId: topic.id,
      notes: { replacements: [{ old: difficulty, new: updated }], append: fresh },
      handoff: { phase: "ready_to_continue", nextAction: "Explain one-sided limits.", workpad: "C2 independently answered; explain one-sided limits next." },
    }),
    save(input.chat.learning),
    reply("You distinguished approaching from reaching. A one-sided limit considers just one direction."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  const state = result.topicUpdates[0].learning
  expect(state.notes).toContain(attempt)
  expect(state.notes).toContain(updated)
  expect(state.notes).toContain(fresh)
  expect(state.notes.indexOf(fresh)).toBeLessThan(state.notes.indexOf("## Materials"))
  expect(state.notes).toContain("## Materials\n\nOriginal lecture assets.")
  expect(state.notes).not.toContain(difficulty)
  expect(state.outline).toEqual(topic.learning.outline)
  expect(result.topicUpdates[0].expected).toEqual(topic.learning)
})

test("ambiguous note edits cannot silently publish the previous staged state", async () => {
  const input = job()
  const topic = input.topics[0]
  const { client, requests } = await provider([
    saveTopic(topic.id, topic.learning),
    call("revise_topic_state", { topicId: topic.id, notes: { replacements: [{ old: "missing difficulty", new: "updated" }] } }),
    save(input.chat.learning),
    reply("Changes saved."),
    call("revise_topic_state", { topicId: topic.id, notes: { append: "An explicit learning need." } }),
    reply("The learning need is recorded."),
  ])
  const result = await runTutorTurn(input, client, () => {})
  expect(requests[4]).toContain("must match exactly once")
  expect(result.topicUpdates[0].learning.notes).toContain("An explicit learning need.")
})

test("compact revisions retain the new-topic plan confirmation boundary", async () => {
  const input = job()
  const session = await createTutorSession(input, () => {})
  const result = await session.execute("revise_topic_state", { topicId: input.topics[0].id, handoff: { phase: "ready_to_continue" } })
  expect(result.success).toBe(false)
  expect(result.text).toContain("Wait for the learner to confirm")
})

test.each(["awaiting_clarification", "contested"] as const)("preserves pending assessment boundaries in phase %s", async (phase) => {
  const input = job()
  const topic = input.topics[0]
  topic.planConfirmed = true
  const key = "A limit describes the approached value as the input approaches a point."
  topic.learning = LearningStateSchema.parse({ ...topic.learning, phase, pendingQuestion: "Explain limits.", privateAnswerKey: key })
  const session = await createTutorSession(input, () => {})
  await session.execute("save_learning_state", input.chat.learning)
  expect(() => session.finish(key)).toThrow("private assessment key")
  await session.execute("save_behaviour_memory", { expected: "", content: key })
  expect(() => session.finish("Preferences saved.")).toThrow("private assessment key")
  expect(() => LearningStateSchema.parse({ ...topic.learning, pendingQuestion: "" })).toThrow("active question")
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
