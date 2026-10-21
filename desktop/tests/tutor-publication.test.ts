import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { newChat, newTopic } from "../src/main/workspace"
import { TopicStateSchema } from "../src/shared/topic-state"
import { createTutorSession } from "../src/runners/tutor"
import { runTutorGraph } from "../src/runners/tutor-graph"
import { messageText } from "../src/shared/message-text"

async function fixture() {
  const chat = newChat(randomUUID())
  const topic = newTopic("Calculus")
  topic.planConfirmed = true
  topic.learning.notes = "# Calculus\n\nA draft plan."
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{
    id: "tp-limits", name: "Limits", references: [{ type: "website", url: "https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function" }],
    goals: [{ objective: "Explain a limit", understoodWhen: ["Distinguish nearby inputs from the value at a point"] }], mistakes: [],
  }], threadTutors: [{ id: chat.id, progress: { "tp-limits": { status: "active", steps: [] } } }] })
  chat.messages.push({ id: randomUUID(), role: "user", content: "idk", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  const tutor = await createTutorSession({
    chat, topics: [{ ...topic, assetDirectory: resolve("tests") }], workspaceTopics: [],
    runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" },
    skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"), apiKey: "test-only",
  }, () => {})
  const question = "As t approaches 2, what value does t + 2 approach?"
  const handoff = { ...chat.learning, phase: "awaiting_answer", pendingQuestion: question, privateAnswerKey: "The independently checked answer stays private.", workpad: "Waiting for the learner's answer." }
  const summary = "## Limits\n\nFor our water tank, the limit describes nearby levels. Inputs near 2 give outputs near 4, even if the level at exactly 2 is missing.\n\nSourced from: [OpenStax](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function)."
  return { chat, topic, tutor, question, handoff, summary }
}

test("stored blocks supply the lesson without a second model-authored explanation", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  const edit = await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { id: "walkthrough", type: "markdown", sectionId: "tp-limits", content: [summary] } }], present: ["walkthrough"] })
  expect(edit.success).toBe(true)
  expect((await tutor.execute("save_learning_state", handoff)).success).toBe(true)
  expect(tutor.hasReply("")).toBe(true)
  const result = tutor.finish("")
  expect(result.reply).toContain(summary)
  expect(result.reply).toContain(question)
  expect(result.topicMutations).toContainEqual(expect.objectContaining({ type: "editTopicContent" }))
})

test("a pending follow-up must be recorded before it reaches the learner", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  const save = await tutor.execute("save_learning_state", handoff)
  expect(save.success).toBe(false)
  expect(save.text).toContain("recordQuestion")
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  expect((await tutor.execute("save_learning_state", handoff)).success).toBe(true)
  expect(tutor.finish(question).reply).toBe(`> [!CHECK]\n> ${question}`)
})

test("the app renders the saved check when the model changes only its final punctuation", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  await tutor.execute("save_learning_state", handoff)
  const reply = `Nearby inputs give nearby outputs.\n\n> [!CHECK]\n> ${question.replace(/\?$/, ".")}`
  let attempts = 0
  const result = await runTutorGraph({
    session: tutor,
    model: async () => { attempts++; return { reply, calls: [], finishAfterTools: false } },
    consumeTools: () => {}, recover: () => {}, maxAttempts: 1,
    exhausted: () => new Error("Unnecessary question repair"),
  })
  expect(attempts).toBe(1)
  expect(result.reply).toBe(`Nearby inputs give nearby outputs.\n\n> [!CHECK]\n> ${question}`)
  expect(tutor.previewReply(reply)).toBe(result.reply)
  const differentQuestion = "Nearby inputs give nearby outputs.\n\n> [!CHECK]\n> What is the derivative of t + 2?"
  expect(tutor.previewReply(differentQuestion)).toBe(result.reply)
  expect(tutor.finish(differentQuestion).reply).toBe(result.reply)
})


test("clarification can preserve the recorded check without rewriting the document", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  await tutor.execute("save_learning_state", handoff)
  const result = tutor.finish(question)
  const input = newChat(randomUUID())
  const topic = newTopic("Calculus")
  topic.planConfirmed = true
  topic.state = TopicStateSchema.parse({ ...topic.state, content: [{ id: "tp-limits", name: "Limits", references: [], goals: [], mistakes: [] }], threadTutors: [{ id: input.id, progress: { "tp-limits": { status: "active", steps: [{ question }] } } }] })
  input.learning = result.learning
  input.messages.push({ id: randomUUID(), role: "user", content: "What do you mean by nearby?", createdAt: new Date().toISOString(), topicIds: [topic.id] })
  const next = await createTutorSession({ chat: input, topics: [{ ...topic, assetDirectory: resolve("tests") }], workspaceTopics: [], runner: { id: input.runnerId, name: "Tutor", provider: "codex", model: "fixture" }, apiKey: "test-only", skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests") }, () => {})
  expect((await next.execute("save_learning_state", { ...result.learning, pendingCheck: { topicId: "scratchpad_1", topicPartId: "tp-limits", stepIndex: 0 } })).success).toBe(true)
})

test("a recorded check is rendered without asking the model to repeat it", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  const { pendingQuestion, ...input } = handoff
  expect((await tutor.execute("save_learning_state", { ...input, pendingCheck: { topicId: "scratchpad_1", topicPartId: "tp-limits", stepIndex: 0 } })).success).toBe(true)
  let attempts = 0
  const result = await runTutorGraph({
    session: tutor,
    model: async () => { attempts++; return { reply: "Inputs close to 2 give outputs close to 4.", calls: [], finishAfterTools: false } },
    consumeTools: () => {}, recover: () => {}, maxAttempts: 1,
    exhausted: () => new Error("The app should render its recorded check"),
  })
  expect(attempts).toBe(1)
  expect(result.reply).toBe(`Inputs close to 2 give outputs close to 4.\n\n> [!CHECK]\n> ${question}`)
  expect(result.learning.pendingCheck).toEqual({ topicId: result.topicMutations[0].topicId, topicPartId: "tp-limits", stepIndex: 0 })
  expect(result.learning.pendingQuestion).toBe(pendingQuestion)
})

test("question references select one recorded step and never accept a second prompt as authority", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question: "What if the function is undefined at 2?" })
  expect((await tutor.execute("save_learning_state", handoff)).success).toBe(false)
  const reference = { topicId: "scratchpad_1", topicPartId: "tp-limits", stepIndex: 0 }
  expect((await tutor.execute("save_learning_state", { ...handoff, pendingQuestion: "A conflicting model copy", pendingCheck: reference })).success).toBe(true)
  expect(tutor.finish("Consider nearby inputs.").learning.pendingQuestion).toBe(question)
  expect((await tutor.execute("save_learning_state", { ...handoff, pendingCheck: { ...reference, stepIndex: 99 } })).success).toBe(false)
  const tool = tutor.tools.find((tool) => tool.type === "function" && tool.function.name === "save_learning_state")
  if (tool?.type !== "function") throw new Error("Missing handoff tool")
  expect(JSON.stringify(tool.function.parameters)).not.toContain('"pendingQuestion"')
  expect(JSON.stringify(tool.function.parameters)).not.toContain('"responseQuestion"')
})

test("response choices and reconstructed history use the same recorded question", async () => {
  const { tutor, handoff, question, summary } = await fixture()
  await tutor.execute("topic_editContent", { topicId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "walkthrough", content: [summary] } }] })
  await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question })
  const { pendingQuestion, ...input } = handoff
  const saved = await tutor.execute("save_learning_state", {
    ...input, pendingCheck: { topicId: "scratchpad_1", topicPartId: "tp-limits", stepIndex: 0 },
    responseOptions: ["4", "Undefined"],
  })
  expect(saved.success).toBe(true)
  const result = tutor.finish("Consider inputs on either side of 2.")
  expect(result.reply).toBe("Consider inputs on either side of 2.")
  expect(result.learning.responseQuestion).toEqual({ prompt: question, options: ["4", "Undefined"] })
  expect(messageText({ content: result.reply, responseQuestion: result.learning.responseQuestion })).toContain(pendingQuestion)
})


test("source citations and Markdown examples remain valid alongside visible content", async () => {
  const { tutor } = await fixture()
  const url = "prune-source://8f34177a-409c-4737-845f-104864d8d0be/4"
  expect(tutor.hasReply(`![Slide](${url})\n\n[Original slide](${url})`)).toBe(true)
  expect(tutor.hasReply("Inputs near 2 give outputs near 4. [Source](edu-material://8f34177a-409c-4737-845f-104864d8d0be/4)")).toBe(true)
  expect(tutor.hasReply(`Example syntax: \`[Slide](${url})\``)).toBe(true)
  expect(tutor.hasReply(`[Slide][source]\n\n[source]: ${url}`)).toBe(true)
})

test("a new draft plan supersedes denied pre-creation writes and waits for confirmation", async () => {
  const { chat, topic } = await fixture()
  chat.scratchpadRequested = true
  chat.messages[0].content = "Help me learn calculus."
  chat.messages[0].topicIds = []
  const tutor = await createTutorSession({
    chat, topics: [], workspaceTopics: [{ ...topic, notes: topic.learning.notes }],
    runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" },
    apiKey: "test-only", skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"),
  }, () => {})
  expect((await tutor.execute("topic_activatePart", { topicId: "scratchpad_1", topicPartId: "tp-limits" })).success).toBe(false)
  expect((await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_1", topicPartId: "tp-limits", question: "What is a limit?" })).success).toBe(false)
  const content = TopicStateSchema.parse(topic.state).content
  expect((await tutor.execute("topic_createTopic", { topic: { type: "topic", version: "11-10-2026", name: "New calculus plan", content } })).success).toBe(true)
  expect((await tutor.execute("topic_activatePart", { topicId: "scratchpad_2", topicPartId: "tp-limits" })).success).toBe(false)
  expect((await tutor.execute("topic_recordQuestion", { topicId: "scratchpad_2", topicPartId: "tp-limits", question: "What is a limit?" })).success).toBe(false)
  expect((await tutor.execute("save_learning_state", { ...chat.learning, phase: "awaiting_plan_confirmation", workpad: "Plan proposed; no teaching until approval." })).success).toBe(true)
  expect(tutor.saved).toBe(true)
  expect(tutor.finish("Here is the source-linked calculus plan. Confirm it to begin.").topicMutations.map((mutation) => mutation.type)).toEqual(["createTopic"])
})

test("waiting for plan confirmation does not discard a malformed curriculum write", async () => {
  const { chat, topic } = await fixture()
  topic.planConfirmed = false
  const tutor = await createTutorSession({
    chat, topics: [{ ...topic, assetDirectory: resolve("tests") }], workspaceTopics: [],
    runner: { id: chat.runnerId, name: "Tutor", provider: "codex", model: "fixture" },
    apiKey: "test-only", skillDirectory: resolve("resources/tutor-me"), assetDirectory: resolve("tests"),
  }, () => {})
  expect((await tutor.execute("topic_updateTopic", { topicId: "scratchpad_1", content: [{ id: "broken" }] })).success).toBe(false)
  await tutor.execute("save_learning_state", { ...chat.learning, phase: "awaiting_plan_confirmation" })
  expect(tutor.saved).toBe(false)
})
