import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { z } from "zod"
import { DocumentSectionSchema } from "../shared/document-index"
import { indexDocument, materialDigest } from "../main/material-extraction"
import { test, type TestContext } from "node:test"
import { newChat, WorkspaceRepository } from "../main/workspace"
import { TutorWorkflowRepository } from "../main/tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { TopicStateSchema } from "../shared/topic-state"
import { createTutorGraph, type WorkflowNativeRunner } from "./tutor-graph"
import { SqliteCheckpointSaver } from "./workflow-checkpointer"

async function fixture(t: TestContext, attached: boolean, content = "/new-topic Teach sections 6.1–6.3 at first-year level") {
  const directory = await mkdtemp(join(tmpdir(), "edu-topic-flow-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content, createdAt: new Date().toISOString(), scratchpadIds: [] })
  const assets = join(directory, "chats", chat.id, "assets")
  await mkdir(assets, { recursive: true })
  if (attached) {
    chat.materials.push(
      { id: randomUUID(), name: "lecture.pdf", kind: "pdf", text: "Lecture", pages: Array.from({ length: 70 }, (_, index) => {
        const headings = new Map([[5, "6.1 Vector spaces"], [11, "6.2 Subspaces"], [15, "6.3 Span"], [17, "6.4 Later material"]])
        return `${headings.get(index + 1) ?? "Continuation"}\nPage ${index + 1}. ${"Definitions and examples for this source section. ".repeat(3)}`
      }) },
      { id: randomUUID(), name: "tutorial.pdf", kind: "pdf", text: "Tutorial practice for later", pages: ["Tutorial exercises for later teaching"] },
    )
    for (const material of chat.materials) {
      const bytes = Buffer.from(`${material.name}: source bytes`)
      await writeFile(join(assets, material.name), bytes)
      const provisional = indexDocument(materialDigest(bytes, ".pdf"), material.pages, material.name)
      // This fixture represents already-reviewed continuation pages; unresolved gaps have separate tests.
      material.documentIndex = indexDocument(provisional.digest, material.pages, material.name, [], provisional.pageMap?.map((page) => ({ ...page, needsVisualReview: false })))
    }
  }
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: assets, sourceCacheDirectory: join(directory, "source-cache") })
  const workflows = new TutorWorkflowRepository(workspace)
  const turn = await workflows.start(job)
  const saver = new SqliteCheckpointSaver(join(directory, "checkpoints.sqlite"))
  t.after(() => saver.close())
  return { workspace, workflows, turn, job, saver, directory }
}

test("one planner creates a scoped topic with host-owned citations and confirmation, then teaching generates dynamic checks", { timeout: 15_000 }, async (t) => {
  const { workspace, workflows, turn, job, saver, directory } = await fixture(t, true)
  let invocations = 0
  const native: WorkflowNativeRunner = async (_input, session) => {
    invocations += 1
    assert.equal(invocations, 1, "Creation must not invoke routing, section readers, or confirmation models")
    const names = session.tools.flatMap((tool) => tool.type === "function" ? [tool.function.name] : [])
    assert.ok(names.includes("submit_topic_plan"))
    assert.equal(names.includes("topic_createTopic"), false)
    assert.equal(names.includes("read_material"), false, "The planner cannot invent page ranges")
    assert.equal(names.includes("review_topic_sources"), false)
    const indexLine = session.instructions.split("\n").find((line) => line.startsWith("Indexed curriculum sections: "))!
    const indexed = z.array(DocumentSectionSchema).parse(JSON.parse(indexLine.slice("Indexed curriculum sections: ".length)))
    const selected = indexed.filter((section) => /^6\.[123] /.test(section.title))
    assert.equal(selected.length, 3)
    assert.equal(indexed.some((section) => /tutorial/i.test(section.title)), false, "Practice attachments have no curriculum section IDs")
    const plan = { title: "Vector spaces", sections: selected.map((section) => ({ sectionId: section.id, goals: [] })) }
    assert.equal((await session.execute("topic_createTopic", { scratchpad: { name: "Arbitrary references" } })).success, false)
    assert.equal((await session.execute("submit_topic_plan", { ...plan, references: [{ type: "pdf", path: "assets/tutorial.pdf", pages: [{ from: 1, to: 3 }] }] })).success, false)
    assert.equal((await session.execute("submit_topic_plan", plan)).success, false, "Unread sections must block creation")
    const read = await session.execute("select_topic_sections", { sectionIds: selected.map((section) => section.id) })
    assert.equal(read.success, true, read.text)
    assert.doesNotMatch(read.text, /Page 17\.|Page 70\.|Tutorial exercises/)
    const saved = await session.execute("submit_topic_plan", plan)
    assert.equal(saved.success, true, saved.text)
    await session.completion
    assert.equal(session.saved, true)
    return session.finish("")
  }
  await createTutorGraph(workflows, native, saver, {}).invoke({ chatId: turn.chatId, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  const complete = workflows.complete(turn.chatId, turn.turnId)
  assert.match(complete.message.content, /Confirm/)
  assert.equal(invocations, 1)
  const role = workflows.get(turn.chatId, turn.turnId).batches[0].jobs[0]
  assert.deepEqual(role.readEvidence.map((entry) => entry.page).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 5))
  const scratchpad = workspace.scratchpad(role.scratchpadId)
  assert.equal(scratchpad.materials.length, 2, "Unread practice attachments remain available for teaching")
  assert.equal(scratchpad.planConfirmed, false)
  assert.equal(workspace.chat(turn.chatId).title, scratchpad.title, "The committed topic names the chat without another model call")
  const state = TopicStateSchema.parse(scratchpad.state)
  assert.deepEqual(state.document?.blocks, [])
  assert.equal(state.threadTutors.every((thread) => Object.values(thread.progress).every((part) => part.steps.length === 0)), true)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  assert.equal(reopened.chat(turn.chatId).learning.phase, "awaiting_plan_confirmation")
  assert.equal(reopened.scratchpad(role.scratchpadId).planConfirmed, false)

  await workspace.mutate((state) => { state.scratchpads.find((scratchpad) => scratchpad.id === role.scratchpadId)!.planConfirmed = true })
  const teachingJob = WorkerJobSchema.parse({ ...job, chat: { ...workspace.chat(turn.chatId), messages: [...workspace.chat(turn.chatId).messages, { id: randomUUID(), role: "user", content: "Confirmed. Start the first section.", createdAt: new Date().toISOString(), scratchpadIds: [scratchpad.id] }] }, scratchpads: [{ ...workspace.scratchpad(scratchpad.id), assetDirectory: join(directory, "scratchpads", scratchpad.id, "assets") }] })
  await workspace.mutate((state) => { state.chats.find((chat) => chat.id === turn.chatId)!.messages = teachingJob.chat.messages })
  const teaching = await workflows.start(teachingJob)
  await createTutorGraph(workflows, async (input, session) => {
    const hasTool = (name: string) => session.tools.some((tool) => tool.type === "function" && tool.function.name === name)
    if (hasTool("topic_recordQuestion")) {
      assert.equal((await session.execute("read_material", { id: job.chat.materials[0].id, firstPage: 5, lastPage: 10 })).success, true)
      assert.equal((await session.execute("topic_activatePart", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-1" })).success, true)
      const result = await session.execute("topic_recordQuestion", { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-1", question: "Which closure condition does your example satisfy?" })
      assert.equal(result.success, true, result.text)
      const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", privateAnswerKey: "Check closure under addition.", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-1", stepIndex: 0 }, nextAction: "Wait for the learner", workpad: "Asked the first check after confirmation" })
      assert.equal(saved.success, true, saved.text)
      return session.finish("Consider closure under addition.")
    }
    if (!session.instructions.includes("Asked a dynamic check")) {
      await session.execute("assume_role", { requests: [{ target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Guide the learner through 6.1 and ask the next check", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [], materialIds: [job.chat.materials[0].id], readDependencies: [], relevantContext: "Learner confirmed" } }] })
      return session.finish("")
    }
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_answer", privateAnswerKey: "Check that adding two members stays inside the set.", pendingCheck: { scratchpadId: "scratchpad_1", scratchpadPartId: "tp-section-1", stepIndex: 0 }, nextAction: "Wait for the answer", workpad: "First dynamic check asked after confirmation" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("Consider closure under addition.")
  }, saver, {}).invoke({ chatId: teaching.chatId, turnId: teaching.turnId }, { configurable: { thread_id: teaching.turnId }, durability: "sync" })
  assert.equal(TopicStateSchema.parse(workspace.scratchpad(scratchpad.id).state).threadTutors[0].progress["tp-section-1"].steps.length, 1)
})

for (const coverage of ["available", "missing", "binary"] as const) {
  test(`one source-free planner inspects actual sources when coverage is ${coverage}`, { timeout: 10_000 }, async (t) => {
    const { workspace, workflows, turn, job, saver } = await fixture(t, false)
    t.mock.method(globalThis, "fetch", async () => {
      if (coverage === "missing") return new Response("Unavailable", { status: 404 })
      if (coverage === "binary") return new Response("%PDF-unparsed source", { headers: { "content-type": "application/pdf" } })
      return new Response("<html><title>University vector spaces</title><body><main>" + "Definitions of vector spaces, closure, span, and required prerequisites. ".repeat(5) + "</main></body></html>")
    })
    let invocations = 0
    await createTutorGraph(workflows, async (_input, session) => {
      invocations += 1
      const inspected = await session.execute("inspect_web_source", { url: "https://example.edu/linear-algebra" })
      if (coverage === "available") {
        assert.equal(inspected.success, true, inspected.text)
        const result = z.object({ section: DocumentSectionSchema }).parse(JSON.parse(inspected.text))
        const saved = await session.execute("submit_topic_plan", { title: "Vector spaces", sections: [{ sectionId: result.section.id, goals: [] }] })
        assert.equal(saved.success, true, saved.text)
      } else {
        assert.equal(inspected.success, false)
        assert.equal((await session.execute("request_topic_clarification", { question: "Can you supply a source or revise the scope?" })).success, true)
      }
      return session.finish("")
    }, saver, {}).invoke({ chatId: turn.chatId, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
    assert.equal(invocations, 1)
    assert.equal(workspace.stateSnapshot.scratchpads.length, coverage === "available" ? 1 : 0)
    const message = workflows.complete(turn.chatId, turn.turnId).message
    assert.equal(message.scratchpadIds.length, coverage === "available" ? 1 : 0)
    assert.equal(workspace.chat(job.chat.id).learning.phase, coverage === "available" ? "awaiting_plan_confirmation" : "awaiting_clarification")
    if (coverage === "available") assert.match(message.content, /https:\/\/example.edu\/linear-algebra/)
  })
}

test("recovery publishes an already staged plan without another planner invocation", { timeout: 10_000 }, async (t) => {
  const { workspace, workflows, turn, saver } = await fixture(t, true)
  let invocations = 0
  const graph = createTutorGraph(workflows, async (_input, session) => {
    invocations += 1
    const line = session.instructions.split("\n").find((line) => line.startsWith("Indexed curriculum sections: "))!
    const [section] = z.array(DocumentSectionSchema).parse(JSON.parse(line.slice("Indexed curriculum sections: ".length)))
    await session.execute("select_topic_sections", { sectionIds: [section.id] })
    const saved = await session.execute("submit_topic_plan", { title: "Vector spaces", sections: [{ sectionId: section.id, goals: [] }] })
    assert.equal(saved.success, true, saved.text)
    throw new Error("Provider disconnected after staging")
  }, saver, {})
  const config = { configurable: { thread_id: turn.turnId }, durability: "sync" as const }
  await assert.rejects(graph.invoke({ chatId: turn.chatId, turnId: turn.turnId }, config), /disconnected after staging/)
  assert.equal(workspace.stateSnapshot.scratchpads.length, 0)
  await graph.invoke(null, config)
  assert.equal(invocations, 1)
  const saved = workflows.complete(turn.chatId, turn.turnId)
  const replay = await workflows.presentPlan(turn.chatId, turn.turnId, workflows.get(turn.chatId, turn.turnId).batches[0].batchId)
  assert.equal(replay.message.id, saved.message.id)
  assert.equal(workspace.stateSnapshot.scratchpads.length, 1)
  assert.equal(workspace.chat(turn.chatId).messages.filter((message) => message.role === "assistant").length, 1)
})

test("an empty creation command asks for intent before allocating a topic", async (t) => {
  const { workspace, workflows, turn, saver } = await fixture(t, false, "/new-topic")
  await createTutorGraph(workflows, async (input, session) => {
    assert.ok(session.tools.some((tool) => tool.type === "function" && tool.function.name === "assume_role"))
    const saved = await session.execute("save_learning_state", { ...input.chat.learning, phase: "awaiting_clarification", nextAction: "Wait for a subject and scope", workpad: "Topic intent is incomplete" })
    assert.equal(saved.success, true, saved.text)
    return session.finish("What subject and scope would you like to study?")
  }, saver, {}).invoke({ chatId: turn.chatId, turnId: turn.turnId }, { configurable: { thread_id: turn.turnId }, durability: "sync" })
  assert.equal(workflows.get(turn.chatId, turn.turnId).batches.length, 0)
  assert.equal(workspace.stateSnapshot.scratchpads.length, 0)
})
