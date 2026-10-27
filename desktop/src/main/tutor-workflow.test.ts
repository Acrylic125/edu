import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { newChat, newScratchpad, WorkspaceRepository } from "./workspace"
import { dispatchWorkflowRequest, TutorWorkflowRepository } from "./tutor-workflow"
import { WorkerJobSchema } from "../shared/contracts"
import { spawn } from "node:child_process"
import { once } from "node:events"

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "edu-workflow-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = new WorkspaceRepository(directory)
  await workspace.load()
  const runner = workspace.stateSnapshot.runners[0]
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Help me learn fractions", createdAt: new Date().toISOString(), scratchpadIds: [] })
  await workspace.mutate((state) => state.chats.push(chat))
  const job = WorkerJobSchema.parse({ chat, runner, scratchpads: [], skillDirectory: "skills", assetDirectory: directory, apiKey: "must-not-persist" })
  return { directory, workspace, job, workflows: new TutorWorkflowRepository(workspace) }
}

for (const type of ["topic", "test", "generic"] as const) {
  test(`a ${type} creation request moves out of an owned thread into durable Staging`, async (t) => {
    const { directory, workspace, job, workflows } = await fixture(t)
    const owner = newScratchpad("Original", "topic")
    const attachment = { id: randomUUID(), name: "request.txt", text: "Request source", pages: [], kind: "text" as const }
    job.chat.materials.push(attachment)
    job.chat.messages[0].materialIds = [attachment.id]
    await mkdir(job.assetDirectory, { recursive: true })
    await writeFile(join(job.assetDirectory, attachment.name), attachment.text)
    job.chat.ownerScratchpadId = owner.id
    job.chat.messages[0].scratchpadIds = [owner.id]
    const history = { ...job.chat.messages[0], id: randomUUID(), content: "Earlier lesson" }
    job.chat.messages.unshift(history)
    await workspace.mutate((state) => {
      state.scratchpads.push(owner)
      state.chats[0] = structuredClone(job.chat)
    })
    const turn = await workflows.start(job)
    const requests = [{ target: { mode: "create" as const, type }, task: "Create the requested scratchpad", requestedAccess: "write" as const,
      context: { learnerMessageIds: [turn.learnerMessageId], materialIds: [], readDependencies: [], relevantContext: "" } }]
    const moved = await workflows.redirectCreation(turn.chatId, turn.turnId, requests)
    assert.ok(moved)
    const original = workspace.chat(turn.chatId)
    assert.deepEqual(original.messages, [history])
    assert.deepEqual(original.movedRequests, [{ messageId: turn.learnerMessageId, messageIndex: 1, chatId: moved.chatId }])
    assert.equal(original.ownerScratchpadId, owner.id)
    assert.equal(original.activeTurnId, undefined)
    assert.equal(original.failedTurnId, undefined)
    const staged = workspace.chat(moved.chatId)
    assert.equal(staged.ownerScratchpadId, undefined)
    assert.equal(staged.scratchpadRequested, true)
    assert.deepEqual(staged.messages, [job.chat.messages[1]])
    assert.equal(staged.providerSession, undefined)
    assert.equal(moved.source.assetDirectory, join(directory, "chats", staged.id, "assets"))
    assert.equal(moved.source.chat.id, staged.id)
    assert.deepEqual(staged.materials, [attachment])
    assert.equal(await readFile(join(moved.source.assetDirectory, attachment.name), "utf8"), attachment.text)
    assert.deepEqual(await workflows.redirectCreation(turn.chatId, turn.turnId, requests), moved)
    await assert.rejects(workflows.retry(turn.chatId, turn.turnId), /moved to Staging/)
    const reopened = new WorkspaceRepository(directory)
    await reopened.load()
    assert.deepEqual(reopened.chat(turn.chatId).movedRequests, original.movedRequests)
    const resumed = new TutorWorkflowRepository(reopened)
    await resumed.retry(moved.chatId, moved.turnId)
    assert.equal(await resumed.redirectCreation(moved.chatId, moved.turnId, requests), undefined)
    const batch = await resumed.assumeRole(moved.chatId, moved.turnId, randomUUID(), requests)
    const role = batch.jobs[0]
    assert.equal(role.role, type)
    const template = newScratchpad("Created in Staging", type).state!
    if (template.type === "topic") {
      await resumed.stage(moved.chatId, moved.turnId, role.jobId, "create", { type: "createTopic", scratchpadId: role.scratchpadId, scratchpad: template })
    } else if (template.type === "test") {
      await resumed.stage(moved.chatId, moved.turnId, role.jobId, "create", { type: "createTest", scratchpadId: role.scratchpadId, test: template })
    } else {
      await resumed.stage(moved.chatId, moved.turnId, role.jobId, "create", { type: "createGeneric", scratchpadId: role.scratchpadId, generic: template })
    }
    await resumed.ready(moved.chatId, moved.turnId, role.jobId, { summary: "Created the scratchpad", evidence: [] })
    await resumed.commitBatch(moved.chatId, moved.turnId, batch.batchId)
    assert.equal(reopened.chat(moved.chatId).ownerScratchpadId, role.scratchpadId)
    assert.equal(reopened.chat(turn.chatId).ownerScratchpadId, owner.id)
    assert.equal(reopened.chat(turn.chatId).messages.length, 1)
    assert.deepEqual(reopened.chat(turn.chatId).movedRequests, [{
      messageId: turn.learnerMessageId, messageIndex: 1, chatId: moved.chatId, scratchpadId: role.scratchpadId,
    }])
    await resumed.commitBatch(moved.chatId, moved.turnId, batch.batchId)
    assert.equal(reopened.chat(turn.chatId).movedRequests.length, 1)
    const saved = new WorkspaceRepository(directory)
    await saved.load()
    assert.equal(saved.publicChats.find((chat) => chat.id === turn.chatId)?.movedRequests[0].scratchpadId, role.scratchpadId)
  })
}

test("a turn retains its original conversation after reopening the workspace", async (t) => {
  const { directory, workspace, job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  await workspace.mutate((state) => {
    state.chats[0].messages.push({ id: randomUUID(), role: "user", content: "A later request", createdAt: new Date().toISOString(), scratchpadIds: [] })
  })
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const saved = new TutorWorkflowRepository(reopened).get(job.chat.id, turn.turnId)
  assert.equal(saved.source.chat.messages.at(-1)?.content, "Help me learn fractions")
  assert.equal(JSON.stringify(saved).includes("must-not-persist"), false)
})

test("a ready role batch commits all its staged writes once and retains its receipt after reopening", async (t) => {
  const { directory, workspace, job, workflows } = await fixture(t)
  const scratchpad = newScratchpad("Fractions", "generic")
  await workspace.mutate((state) => state.scratchpads.push(scratchpad))
  job.scratchpads = [{ ...scratchpad, assetDirectory: directory }]
  job.chat.scratchpadHandles = [scratchpad.id]
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Record the learner's notes",
    requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  }])
  const role = batch.jobs[0]
  await workflows.stage(turn.chatId, turn.turnId, role.jobId, "notes-1", { type: "updateGeneric", scratchpadId: scratchpad.id, summary: "# Fractions\n\nOne half is 1/2." })
  await workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Recorded one half.", evidence: [] })
  const receipt = await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const replay = await new TutorWorkflowRepository(reopened).commitBatch(turn.chatId, turn.turnId, batch.batchId)
  assert.deepEqual(replay, receipt)
  assert.equal(reopened.scratchpad(scratchpad.id).learning.notes, "# Fractions\n\nOne half is 1/2.")
})

test("a creation role cannot stage a different scratchpad type", async (t) => {
  const { job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "create", type: "topic" }, task: "Create a curriculum", requestedAccess: "write",
    context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  }])
  await assert.rejects(workflows.stage(turn.chatId, turn.turnId, batch.jobs[0].jobId, "wrong-type", {
    type: "createGeneric", scratchpadId: batch.jobs[0].scratchpadId,
    generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] },
  }), /role|type/i)
})

test("returning a request for coordination cannot commit writes or publish a role reply", async (t) => {
  const { workspace, job, workflows } = await fixture(t)
  const scratchpad = newScratchpad("Fractions", "generic")
  await workspace.mutate((state) => state.scratchpads.push(scratchpad))
  job.scratchpads = [{ ...scratchpad, assetDirectory: job.assetDirectory }]
  job.chat.scratchpadHandles = [scratchpad.id]
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Handle the latest request", requestedAccess: "write", replyToLearner: true,
    context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  }])
  const role = batch.jobs[0]
  await assert.rejects(workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Needs another target", evidence: [], needsCoordination: true, response: { reply: "A provisional reply", learning: job.chat.learning } }), /not granted a direct learner reply/)
  await workflows.stage(turn.chatId, turn.turnId, role.jobId, "notes", { type: "updateGeneric", scratchpadId: scratchpad.id, summary: "Changed notes" })
  await assert.rejects(workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Needs another target", evidence: [], needsCoordination: true }), /without staged writes/)
  assert.deepEqual(workspace.scratchpad(scratchpad.id).state, scratchpad.state)
})

test("direct role replies require an independent grant and committed writes without exposing their handoff in summaries", async (t) => {
  const { workspace, job, workflows } = await fixture(t)
  const scratchpad = newScratchpad("Fractions", "generic")
  await workspace.mutate((state) => state.scratchpads.push(scratchpad))
  job.scratchpads = [{ ...scratchpad, assetDirectory: job.assetDirectory }]
  job.chat.scratchpadHandles = [scratchpad.id]
  const turn = await workflows.start(job)
  const request = { target: { mode: "existing" as const, scratchpadHandle: "scratchpad_1" }, task: "Write the fraction notes", requestedAccess: "write" as const, replyToLearner: true,
    context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  }
  await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ ...request, requestedAccess: "read" }]), /independent write role/)
  await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [request, request]), /independent write role/)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [request])
  const role = batch.jobs[0]
  await assert.rejects(workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Done", evidence: [] }), /reply and handoff/)
  await workflows.stage(turn.chatId, turn.turnId, role.jobId, "notes", { type: "updateGeneric", scratchpadId: scratchpad.id, summary: "# Fractions\n\nOne half is 1/2." })
  await workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Updated fraction notes", evidence: [], response: { reply: "Your fraction notes are ready.", learning: { ...job.chat.learning, privateAnswerKey: "PRIVATE_ROLE_KEY", workpad: "Saved fraction notes", nextAction: "Wait for the learner" } } })
  await assert.rejects(workflows.presentRoleReply(turn.chatId, turn.turnId, batch.batchId), /committed/)
  const receipt = await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  assert.equal(JSON.stringify(receipt).includes("PRIVATE_ROLE_KEY"), false)
  assert.equal(JSON.stringify(receipt).includes("Your fraction notes are ready."), false)
  const completed = await workflows.presentRoleReply(turn.chatId, turn.turnId, batch.batchId, 750)
  assert.equal(completed.message.content, "Your fraction notes are ready.")
  assert.equal(completed.message.durationMs, 750)
  assert.deepEqual(await workflows.presentRoleReply(turn.chatId, turn.turnId, batch.batchId, 1000), completed)
  assert.equal(workspace.chat(job.chat.id).messages.length, 2)
})

test("a reply waits for required batches and publishes its handoff and message only once", async (t) => {
  const { workspace, job, workflows } = await fixture(t)
  const scratchpad = newScratchpad("Fractions", "generic")
  await workspace.mutate((state) => state.scratchpads.push(scratchpad))
  job.workspaceScratchpads = [{ ...scratchpad, notes: scratchpad.learning.notes }]
  job.chat.scratchpadHandles = [scratchpad.id]
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Read the notes", requestedAccess: "read",
    context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  }])
  const handoffRef = await workflows.saveHandoff(turn.chatId, turn.turnId, randomUUID(), job.chat.learning)
  await assert.rejects(workflows.saveReply(turn.chatId, turn.turnId, "One half is 1/2.", handoffRef), /batch|commit/i)
  assert.equal(workspace.chat(turn.chatId).messages.length, 1)
  await workflows.ready(turn.chatId, turn.turnId, batch.jobs[0].jobId, { summary: "Read the notes", evidence: [] })
  const batchReceipt = await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  const receipt = await workflows.saveReply(turn.chatId, turn.turnId, "One half is 1/2.", handoffRef)
  assert.deepEqual(await workflows.saveReply(turn.chatId, turn.turnId, "One half is 1/2.", handoffRef), receipt)
  assert.deepEqual(receipt.committedBatchReceiptIds, [batchReceipt.receiptId])
  const complete = workflows.complete(turn.chatId, turn.turnId)
  assert.equal(complete.message.content, "One half is 1/2.")
  assert.equal(workspace.chat(turn.chatId).messages.length, 2)
})

test("a reply retains its host duration after completion, duplicate save, and workspace reopen", async (t) => {
  // Publish "One half is 1/2." with host duration 1250 ms, then replay with 2500 ms.
  // The original assistant message must retain 1250 ms after completion and a disk reload.
  const { directory, job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  const handoffRef = await workflows.saveHandoff(turn.chatId, turn.turnId, randomUUID(), job.chat.learning)
  const request = { operation: "saveReply" as const, chatId: turn.chatId, turnId: turn.turnId, reply: "One half is 1/2.", handoffRef }
  const receipt = await dispatchWorkflowRequest(workflows, request, 1250)
  const completed = workflows.complete(turn.chatId, turn.turnId)

  // A later host measurement must not overwrite the duration of an already published reply.
  const replay = await dispatchWorkflowRequest(workflows, request, 2500)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const saved = new TutorWorkflowRepository(reopened).complete(turn.chatId, turn.turnId)
  assert.deepEqual(replay, receipt)
  assert.deepEqual(saved.receipt, completed.receipt)
  assert.equal(reopened.chat(turn.chatId).messages.filter((message) => message.role === "assistant").length, 1)
  assert.equal(saved.message.id, completed.message.id)
  assert.equal(saved.message.durationMs, 1250)
  assert.equal(completed.message.durationMs, 1250)
})

test("a batch conflict leaves every scratchpad unchanged and no receipt", async (t) => {
  const { directory, workspace, job, workflows } = await fixture(t)
  const first = newScratchpad("Fractions", "generic")
  const second = newScratchpad("Decimals", "generic")
  await workspace.mutate((state) => state.scratchpads.push(first, second))
  job.scratchpads = [first, second].map((scratchpad) => ({ ...scratchpad, assetDirectory: directory }))
  job.chat.scratchpadHandles = [first.id, second.id]
  const turn = await workflows.start(job)
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), ["scratchpad_1", "scratchpad_2"].map((scratchpadHandle) => ({
    target: { mode: "existing", scratchpadHandle }, task: "Add notes", requestedAccess: "write",
    context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
  })))
  for (const role of batch.jobs) {
    await workflows.stage(turn.chatId, turn.turnId, role.jobId, "notes", { type: "updateGeneric", scratchpadId: role.scratchpadId, summary: "# Changed\n\nStaged notes" })
    await workflows.ready(turn.chatId, turn.turnId, role.jobId, { summary: "Added notes", evidence: [] })
  }
  await workspace.mutate((state) => { state.scratchpads.find((scratchpad) => scratchpad.id === second.id)!.learning.notes = "# Decimals\n\nEdited by the learner." })
  await assert.rejects(workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId), /changed|conflict/i)
  assert.equal(workspace.scratchpad(first.id).learning.notes, "# Fractions\n\n")
  assert.equal(workflows.get(turn.chatId, turn.turnId).batches[0].receipt, undefined)
})

test("Retry resumes its failed turn without adding a learner message and rejects another chat's turn", async (t) => {
  const { workspace, job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  await workflows.fail(turn.chatId, turn.turnId, "Provider disconnected")
  const retried = await workflows.retry(turn.chatId, turn.turnId)
  assert.equal(retried.turnId, turn.turnId)
  assert.equal(retried.status, "running")
  assert.equal(workspace.chat(turn.chatId).messages.length, 1)
  await assert.rejects(workflows.retry(randomUUID(), turn.turnId), /belong|chat/i)
})

test("later batches can update a scratchpad created earlier in the same turn", async (t) => {
  const { job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  const context = { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" }
  const first = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ target: { mode: "create", type: "generic" }, task: "Create notes", requestedAccess: "write", context }])
  const created = first.jobs[0]
  await workflows.stage(turn.chatId, turn.turnId, created.jobId, "create", { type: "createGeneric", scratchpadId: created.scratchpadId, generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] } })
  await workflows.ready(turn.chatId, turn.turnId, created.jobId, { summary: "Created notes", evidence: [] })
  await workflows.commitBatch(turn.chatId, turn.turnId, first.batchId)
  const next = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ target: { mode: "existing", scratchpadHandle: created.scratchpadHandle }, task: "Add an example", requestedAccess: "write", context }])
  assert.equal(next.jobs[0].scratchpadId, created.scratchpadId)
  assert.equal(next.jobs[0].role, "generic")
})

test("the host rejects role requests for messages and materials outside its pinned context", async (t) => {
  const { job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "create", type: "generic" }, task: "Read an unrelated file", requestedAccess: "write",
    context: { learnerMessageIds: [], materialIds: [randomUUID()], readDependencies: [], relevantContext: "" },
  }]), /material|grant/i)
  await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
    target: { mode: "create", type: "generic" }, task: "Read a later request", requestedAccess: "write",
    context: { learnerMessageIds: [randomUUID()], materialIds: [], readDependencies: [], relevantContext: "" },
  }]), /message|context/i)
})

test("reopening an interrupted turn stops its recorded native attempt before Retry", async (t) => {
  const { directory, job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  const invocationId = randomUUID()
  await workflows.beginInvocation(turn.chatId, turn.turnId, invocationId)
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  t.after(() => { child.kill("SIGKILL") })
  await once(child, "spawn")
  assert.ok(child.pid)
  const exited = once(child, "exit")
  await workflows.nativeStarted(turn.chatId, turn.turnId, invocationId, child.pid)
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  const recovered = new TutorWorkflowRepository(reopened)
  await recovered.recoverInterruptedTurns()
  await exited
  const retried = await recovered.retry(turn.chatId, turn.turnId)
  assert.equal(retried.status, "running")
  assert.equal(reopened.chat(turn.chatId).messages.length, 1)
})

test("reading a tagged scratchpad does not revoke its write permission in a later batch", async (t) => {
  const { directory, workspace, job, workflows } = await fixture(t)
  const scratchpad = newScratchpad("Fractions", "generic")
  await workspace.mutate((state) => state.scratchpads.push(scratchpad))
  job.scratchpads = [{ ...scratchpad, assetDirectory: directory }]
  job.chat.scratchpadHandles = [scratchpad.id]
  const turn = await workflows.start(job)
  const request = { target: { mode: "existing" as const, scratchpadHandle: "scratchpad_1" }, task: "Read notes", requestedAccess: "read" as const, context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } }
  const batch = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [request])
  await workflows.ready(turn.chatId, turn.turnId, batch.jobs[0].jobId, { summary: "Read notes", evidence: [] })
  await workflows.commitBatch(turn.chatId, turn.turnId, batch.batchId)
  const next = await workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{ ...request, requestedAccess: "write", task: "Update notes" }])
  assert.equal(next.jobs[0].access, "write")
})

test("prepared contexts retain their advertised tool schemas after reopening", async (t) => {
  const { directory, job, workflows } = await fixture(t)
  const turn = await workflows.start(job)
  const tools = [{ name: "assume_role", description: "Delegate scratchpad work", inputSchema: { type: "object" as const, properties: {} } }]
  await workflows.saveContext(turn.chatId, turn.turnId, { contextVersion: randomUUID(), tutorStepId: randomUUID(), key: "entry:full", source: turn.source, summary: "", instructions: "Tutor the learner", tools })
  const reopened = new WorkspaceRepository(directory)
  await reopened.load()
  assert.deepEqual(new TutorWorkflowRepository(reopened).get(turn.chatId, turn.turnId).contexts[0].tools, tools)
})

test("a batch rejects a role that depends on another job's pending write", async (t) => {
  const { directory, workspace, job, workflows } = await fixture(t)
  const targets = [newScratchpad("Fractions", "generic"), newScratchpad("Decimals", "generic")]
  await workspace.mutate((state) => state.scratchpads.push(...targets))
  job.scratchpads = targets.map((scratchpad) => ({ ...scratchpad, assetDirectory: directory }))
  job.chat.scratchpadHandles = targets.map((scratchpad) => scratchpad.id)
  const turn = await workflows.start(job)
  const context = { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" }
  await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [
    { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Update fractions", requestedAccess: "write", context },
    { target: { mode: "existing", scratchpadHandle: "scratchpad_2" }, task: "Compare with the updated fractions", requestedAccess: "read", context: { ...context, readDependencies: ["scratchpad_1"] } },
  ]), /dependent|later batch/i)
})

test("creation access is validated before a role batch is persisted", async (t) => {
  const { workflows, job } = await fixture(t)
  const turn = await workflows.start(job)
  for (const type of ["topic", "test", "generic"] as const) {
    for (const replyToLearner of [false, true]) {
      await assert.rejects(workflows.assumeRole(turn.chatId, turn.turnId, randomUUID(), [{
        target: { mode: "create", type }, task: "Create the requested scratchpad", requestedAccess: "read", replyToLearner,
        context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" },
      }]), /Creation requires write access/)
      assert.equal(workflows.get(turn.chatId, turn.turnId).batches.length, 0)
    }
  }
})
