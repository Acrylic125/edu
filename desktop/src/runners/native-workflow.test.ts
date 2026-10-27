import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { z } from "zod"
import { newChat, newScratchpad } from "../main/workspace"
import { WorkerJobSchema } from "../shared/contracts"
import { createWorkflowRoleSession, createWorkflowTutorSession } from "./workflow-session"
import { RoleJobSchema } from "../shared/tutor-workflow"
import { materialDigest } from "../main/material-extraction"
import { runCodexTutorTurn } from "./codex"

test("the Codex adapter uses the prepared scope and yields delegation without resuming an older full transcript", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-native-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = join(directory, "codex.mjs")
  const log = join(directory, "requests.jsonl")
  await writeFile(executable, `#!${process.execPath}
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(${JSON.stringify(log)}, line + "\\n");
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "model/list") send({ id: message.id, result: { data: [{ model: "test", displayName: "Test model" }] } });
  if (message.method === "thread/resume") send({ id: message.id, error: { code: -1, message: "The old full transcript must not be resumed" } });
  if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "prepared-thread" } } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: {} });
    send({ id: "delegate", method: "item/tool/call", params: { threadId: "prepared-thread", tool: "assume_role", arguments: { requests: [{ target: { mode: "create", type: "generic" }, task: "Create notes", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } }] } } });
  }
  // No turn/completed: the adapter must yield as soon as delegation is ready.
});
`, { mode: 0o700 })
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "Create notes", createdAt: new Date().toISOString(), scratchpadIds: [] })
  chat.providerSession = { provider: "codex", threadId: "old-full-transcript", home: directory, executable, toolVersion: 23, status: "ready" }
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: join(directory, "assets"), codex: { executable, home: directory } })
  const tutor = await createWorkflowTutorSession(job, [], "Earlier conversation summary", () => {})
  await runCodexTutorTurn(job, () => {}, () => {}, () => {}, undefined, () => {}, tutor.session)
  assert.equal(tutor.requests?.[0].task, "Create notes")
  const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => z.object({ method: z.string().optional(), params: z.json().optional() }).parse(JSON.parse(line)))
  assert.equal(requests.some((request) => request.method === "thread/resume"), false)
  const started = requests.find((request) => request.method === "thread/start")
  assert.match(JSON.stringify(started?.params), /Earlier conversation summary/)
  assert.equal(JSON.stringify(started?.params).includes("generic_updateScratchpad"), false)
})

test("a successful Codex plan write ends the native invocation without finish_role or a final response", { timeout: 10_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-native-plan-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = join(directory, "codex.mjs")
  const sectionId = `section-${materialDigest(Buffer.from("Halves and quarters"), ".txt").slice(0, 16)}-1`
  const plan = { title: "Fractions", sections: [{ sectionId, goals: [] }] }
  await writeFile(executable, `#!${process.execPath}
import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "model/list") send({ id: message.id, result: { data: [{ model: "test", displayName: "Test" }] } });
  if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "plan-thread" } } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: {} });
    send({ id: "plan", method: "item/tool/call", params: { threadId: "plan-thread", tool: "submit_topic_plan", arguments: ${JSON.stringify(plan)} } });
  }
});
`, { mode: 0o700 })
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.materials.push({ id: randomUUID(), name: "fractions.txt", kind: "text", text: "Halves and quarters", pages: [] })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: join(directory, "assets"), codex: { executable, home: directory } })
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: randomUUID(), scratchpadHandle: "scratchpad_1", role: "topic", access: "write", mode: "create", baseVersion: null, snapshot: null, operations: [], request: { target: { mode: "create", type: "topic" }, task: "Plan fractions", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [chat.materials[0].id], readDependencies: [], relevantContext: "" } } })
  let persisted = false
  const { session } = await createWorkflowRoleSession(job, role, async () => { persisted = true }, () => {})
  assert.equal((await session.execute("select_topic_sections", { sectionIds: [sectionId] })).success, true)
  const events: string[] = []
  const result = await runCodexTutorTurn(job, () => {}, () => {}, (event) => events.push(event), undefined, () => {}, session)
  assert.equal(persisted, true)
  assert.match(result.reply, /learner confirmation/)
  assert.ok(events.includes("turn.yielded"))
})


test("ordinary Codex turns resume the native conversation and send only the new learner message", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "edu-native-resume-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = join(directory, "codex.mjs")
  const log = join(directory, "requests.jsonl")
  const runner = { id: randomUUID(), name: "Tutor", provider: "codex", model: "test" }
  const chat = newChat(runner.id)
  chat.messages.push({ id: randomUUID(), role: "user", content: "First learner message", createdAt: new Date().toISOString(), scratchpadIds: [] })
  await writeFile(executable, `#!${process.execPath}
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(${JSON.stringify(log)}, line + "\\n");
  if (message.method === "initialize") send({ id: message.id, result: {} });
  if (message.method === "model/list") send({ id: message.id, result: { data: [{ model: "test", displayName: "Test" }] } });
  if (message.method === "thread/start" || message.method === "thread/resume") send({ id: message.id, result: { thread: { id: "ordinary-thread" } } });
  if (message.method === "turn/start") {
    send({ id: message.id, result: {} });
    send({ method: "item/started", params: { threadId: "ordinary-thread", item: { id: "answer", type: "agentMessage", phase: "final_answer" } } });
    send({ method: "item/agentMessage/delta", params: { threadId: "ordinary-thread", itemId: "answer", delta: "A " } });
    send({ method: "item/agentMessage/delta", params: { threadId: "ordinary-thread", itemId: "answer", delta: "response" } });
    send({ id: "save", method: "item/tool/call", params: { threadId: "ordinary-thread", tool: "save_learning_state", arguments: ${JSON.stringify(chat.learning)} } });
  }
  if (message.id === "save" && !message.method) {
    send({ method: "item/completed", params: { threadId: "ordinary-thread", item: { type: "agentMessage", text: "A response", phase: "final_answer" } } });
    send({ method: "turn/completed", params: { threadId: "ordinary-thread", turn: { status: "completed" } } });
  }
});
`, { mode: 0o700 })
  const job = WorkerJobSchema.parse({ runner, chat, scratchpads: [], skillDirectory: resolve("resources/tutor-me"), assetDirectory: directory, codex: { executable, home: directory } })
  const first = await createWorkflowTutorSession(job, [], "", () => {})
  first.session.resumeProviderSession = true
  const previewsBeforeSave: string[] = []
  const result = await runCodexTutorTurn(job, () => {}, () => {}, () => {}, undefined, (text) => { if (!first.session.saved && text) previewsBeforeSave.push(text) }, first.session)
  assert.deepEqual(previewsBeforeSave, ["A ", "A response"], "Provider deltas must reach the learner before the handoff is saved")
  job.chat.providerSession = result.providerSession
  job.chat.messages.push({ id: randomUUID(), role: "assistant", content: result.reply, createdAt: new Date().toISOString(), scratchpadIds: [] })
  job.chat.messages.push({ id: randomUUID(), role: "user", content: "Second learner message", createdAt: new Date().toISOString(), scratchpadIds: [] })
  const second = await createWorkflowTutorSession(job, [], "", () => {})
  second.session.resumeProviderSession = true
  await runCodexTutorTurn(job, () => {}, () => {}, () => {}, undefined, () => {}, second.session)
  const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => z.object({ method: z.string().optional(), params: z.json().optional() }).parse(JSON.parse(line)))
  assert.equal(requests.filter((request) => request.method === "thread/start").length, 1)
  assert.equal(requests.filter((request) => request.method === "thread/resume").length, 1)
  const input = requests.filter((request) => request.method === "turn/start").at(-1)?.params
  assert.match(JSON.stringify(input), /Second learner message/)
  assert.equal(JSON.stringify(input).includes("First learner message"), false)
  const target = newScratchpad("Response notes", "generic")
  job.scratchpads = [{ ...target, assetDirectory: directory }]
  job.chat.scratchpadHandles = [target.id]
  const role = RoleJobSchema.parse({ jobId: randomUUID(), stageId: randomUUID(), scratchpadId: target.id, scratchpadHandle: "scratchpad_1", role: "generic", access: "write", mode: "existing", snapshot: target, baseVersion: "v1", operations: [],
    request: { target: { mode: "existing", scratchpadHandle: "scratchpad_1" }, task: "Reply to the learner", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [job.chat.messages.at(-1)!.id], materialIds: [], readDependencies: [], relevantContext: "" } },
  })
  const child = await createWorkflowRoleSession(job, role, async () => {}, () => {})
  const rolePreviews: string[] = []
  const roleResult = await runCodexTutorTurn(child.job, () => {}, () => {}, () => {}, undefined, (text) => { if (text) rolePreviews.push(text) }, child.session)
  assert.ok(rolePreviews.includes("A "))
  assert.ok(rolePreviews.includes("A response"))
  assert.equal(roleResult.reply, "A response")
  assert.equal(child.output?.response?.reply, "A response")
  const afterRole = (await readFile(log, "utf8")).trim().split("\n").map((line) => z.object({ method: z.string().optional() }).parse(JSON.parse(line)))
  assert.equal(afterRole.filter((request) => request.method === "thread/start").length, 2, "The role must start an isolated provider context")
  assert.equal(afterRole.filter((request) => request.method === "thread/resume").length, 1, "The role must not resume the coordinator's provider thread")
})
