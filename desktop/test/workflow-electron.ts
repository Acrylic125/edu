import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { app, BrowserWindow, ipcMain } from "electron"
import { setTimeout } from "node:timers/promises"
import { newChat, newScratchpad, WorkspaceRepository } from "../src/main/workspace"
import { RunnerManager } from "../src/runners/manager"
import { TutorWorkflowRepository } from "../src/main/tutor-workflow"
import { Channel, RuntimeUpdateSchema, SnapshotSchema } from "../src/shared/contracts"
import { createBatchedUpdate } from "../src/shared/batched-update"

async function main() {
  await app.whenReady()
  const directory = await mkdtemp(join(tmpdir(), "edu-electron-workflow-"))
  let manager: RunnerManager | undefined
  let exitCode = 0
  try {
    const planMaterials = [
      { id: randomUUID(), name: "vector-spaces-copy.pdf", kind: "pdf" as const, text: "Vector spaces", pages: Array.from({ length: 70 }, (_, index) => `${["6.1 Vector spaces", "6.2 Subspaces", "6.3 Span", "6.4 Later material"][index] ?? "Continuation"}\nLecture page ${index + 1}. ${"Definition and source example. ".repeat(4)}`) },
      { id: randomUUID(), name: "tutorial-copy.pdf", kind: "pdf" as const, text: "Vector spaces tutorial", pages: ["Tutorial page 1", "Tutorial page 2", "Tutorial page 3"] },
    ]
    const executable = join(directory, "claude.mjs")
    // This process is the external provider boundary; the application and MCP transport remain real.
    await writeFile(executable, `#!/usr/bin/env node
  import { readFileSync, existsSync, writeFileSync } from "node:fs";
  const config = JSON.parse(process.argv[process.argv.indexOf("--mcp-config") + 1]).mcpServers.edu;
  const materials = ${JSON.stringify(planMaterials.map(({ id, name, pages }) => ({ id, name, pageCount: pages.length })))};
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const call = async (name, args, allowError = false) => {
    const response = await fetch(config.url, { method: "POST", headers: { ...config.headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const result = await response.json();
    if (result.error || (result.result?.isError && !allowError)) throw new Error(JSON.stringify(result));
    return result.result;
  };
  let reply = "";
  if (input.includes("Greeting existing topic")) {
    await call("save_learning_state", { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for learner", notes: "", workpad: "Greeted the learner." });
    reply = "Hello!";
  } else if (input.includes("Indexed curriculum sections: ")) {
    const indexLine = input.split("\\n").find((line) => line.startsWith("Indexed curriculum sections: "));
    const sections = JSON.parse(indexLine.slice("Indexed curriculum sections: ".length)).filter((section) => /^6\\.[123] /.test(section.title));
    await call("select_topic_sections", { sectionIds: sections.map((section) => section.id) });
    const blocked = await call("topic_editContent", { scratchpadId: "scratchpad_1", changes: [{ action: "add", block: { type: "markdown", id: "premature-lesson", content: ["Do not teach before confirmation"] } }] }, true);
    if (!blocked.isError) throw new Error("Premature teaching was allowed");
    await call("submit_topic_plan", { title: "Vector spaces plan", sections: sections.map((section) => ({ sectionId: section.id, goals: [] })) });
    await new Promise(() => {});
  } else if (input.includes("Complete this topic scratchpad task")) {
    const target = input.match(/Target: (scratchpad_[0-9]+)/)?.[1];
    if (!target) throw new Error("Missing role handle");
    const blocked = await call("test_getQuestions", { testId: target }, true);
    if (!blocked.isError) throw new Error("Topic role received test tools");
    if (input.includes("## Vary the rhythm")) throw new Error("General skill bodies were eagerly injected");
    await call("read_skill", { path: "skills/WRITING_STYLE.md" });
    await call("read_material", { id: materials[0].id, firstPage: 1, lastPage: 1 });
    await call("topic_activatePart", { scratchpadId: target, scratchpadPartId: "tp-section-1" });
    await call("topic_editContent", { scratchpadId: target, changes: [{ action: "add", block: { type: "markdown", id: "closure-lesson", content: ["Consider closure under addition."] } }], present: ["closure-lesson"] });
    await call("topic_recordQuestion", { scratchpadId: target, scratchpadPartId: "tp-section-1", question: "Does your example satisfy closure under addition?" });
    await call("save_learning_state", { phase: "awaiting_answer", outline: [], currentSection: "Vector spaces", pendingQuestion: "", privateAnswerKey: "Adding two members must remain inside the set.", nextAction: "Wait for the learner answer", notes: "", workpad: "Asked a dynamic check after confirmation." });
    await call("finish_role", { summary: "Completed the first section", evidence: [] });
    await new Promise(() => {});
  } else if (input.includes("Start the confirmed topic")) {
    const directoryLine = input.split("\\n").find((line) => line.startsWith("Scratchpad directory: "));
    const targets = JSON.parse(directoryLine.slice("Scratchpad directory: ".length));
    const target = targets.find((target) => target.title === "Vector spaces plan");
    await call("assume_role", { requests: [{ target: { mode: "existing", scratchpadHandle: target.handle }, task: "Guide confirmed topic and ask one dynamic check", requestedAccess: "write", replyToLearner: true, context: { learnerMessageIds: [], materialIds: [materials[0].id], readDependencies: [], relevantContext: "Learner confirmed" } }] });
  } else if (input.includes("Proposed plan saved")) {
    await call("save_learning_state", { phase: "awaiting_plan_confirmation", outline: [], currentSection: "", pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for plan confirmation", notes: "", workpad: "The source-ordered PDF plan is ready for confirmation." });
    reply = "Please confirm the vector spaces plan.";
  } else if (input.includes("Create a topic plan from the PDFs")) {
    await call("assume_role", { requests: [{ target: { mode: "create", type: "topic" }, task: "Propose the first three parts and wait for learner confirmation", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: materials.map((material) => material.id), readDependencies: [], relevantContext: "" } }] });
  } else if (input.includes("Complete this generic scratchpad task")) {
    await call("generic_createGeneric", { generic: { type: "generic", version: "19-10-2026", name: "Fractions", references: [] } });
    await call("finish_role", { summary: "Created fraction notes", evidence: [] });
  } else if (input.includes("Created fraction notes")) {
    const failure = ${JSON.stringify(join(directory, "failed-once"))};
    if (!existsSync(failure)) { writeFileSync(failure, "failed"); process.exit(1); }
    await call("save_learning_state", { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", privateAnswerKey: "", nextAction: "Wait for learner", notes: "", workpad: "Created the requested fraction notes." });
    reply = "Your fraction notes are ready.";
  } else {
    await call("assume_role", { requests: [{ target: { mode: "create", type: "generic" }, task: "Create fraction notes", requestedAccess: "write", context: { learnerMessageIds: [], materialIds: [], readDependencies: [], relevantContext: "" } }] });
  }
  process.stdout.write(JSON.stringify({ structured_output: { reply } }));
  `, { mode: 0o700 })
    const workspace = new WorkspaceRepository(directory)
    await workspace.load()
    const runner = { ...workspace.stateSnapshot.runners[0], provider: "claude" as const, model: "test" }
    const chat = newChat(runner.id)
    chat.titleGenerated = true
    await workspace.mutate((state) => { state.runners = [runner]; state.chats.push(chat) })
    let fullUpdates = 0
    let runtimeUpdates = 0
    const messageId = randomUUID()
    let notifiedBeforeWorkflow = false
    manager = new RunnerManager(workspace, resolve(process.argv[2] ?? ".test-out/worker.js"), resolve(process.argv[3] ?? "resources/tutor-me"), async () => ({ apiKey: "", cli: { provider: "claude", executable, directory } }), () => {
      fullUpdates += 1
      const saved = workspace.chat(chat.id)
      if (saved.messages.some((message) => message.id === messageId) && !saved.activeTurnId) notifiedBeforeWorkflow = true
    }, true, () => { runtimeUpdates += 1 })
    const waitFor = async (status: "error" | "ready") => {
      for (let attempt = 0; attempt < 400; attempt++) {
        const runtime = manager!.statuses.find((runtime) => runtime.chatId === chat.id)
        if (runtime?.status === status) return runtime
        await setTimeout(25)
      }
      throw new Error(`Timed out waiting for ${status}: ${JSON.stringify(manager!.statuses)}`)
    }
    await manager.send({ chatId: chat.id, messageId, content: "/new-generic Create fraction notes" })
    assert.equal(workspace.chat(chat.id).messages[0].id, messageId, "The saved user message must retain its client ID")
    assert.equal(notifiedBeforeWorkflow, true, "The saved user message must be published before workflow setup")
    const failure = await waitFor("error")
    const failedTurnId = failure.turnId
    assert.ok(failedTurnId, JSON.stringify(failure))
    assert.equal(workspace.stateSnapshot.scratchpads.length, 1, JSON.stringify(failure))
    await manager.retry({ chatId: chat.id, turnId: failedTurnId })
    await waitFor("ready")
    assert.equal(workspace.stateSnapshot.scratchpads.length, 1)
    assert.deepEqual(workspace.chat(chat.id).messages.map((message) => message.role), ["user", "assistant"])
    const retriedReply = workspace.chat(chat.id).messages.at(-1)
    assert.ok(retriedReply?.durationMs !== undefined && retriedReply.durationMs > 0, "The completed response must retain its duration after Retry")
    assert.equal(new TutorWorkflowRepository(workspace).complete(chat.id, failedTurnId).message.content, "Your fraction notes are ready.")
    console.log("PASS: Electron send → delegation → commit → provider failure → Retry → persisted reply")
    const planChat = newChat(runner.id)
    planChat.titleGenerated = true
    planChat.materials = planMaterials
    const assets = join(directory, "chats", planChat.id, "assets")
    await mkdir(assets, { recursive: true })
    for (const material of planMaterials) await writeFile(join(assets, material.name), "Extracted-PDF fixture")
    await workspace.mutate((state) => state.chats.push(planChat))
    await manager.send({ chatId: planChat.id, content: "/new-topic Create a topic plan from the PDFs" })
    for (let attempt = 0; attempt < 400; attempt++) {
      const runtime = manager.statuses.find((runtime) => runtime.chatId === planChat.id)
      assert.notEqual(runtime?.status, "error", runtime?.error ?? "Topic planning failed")
      if (runtime?.status === "ready") break
      await setTimeout(25)
    }
    const savedPlanChat = workspace.chat(planChat.id)
    assert.deepEqual(savedPlanChat.messages.map((message) => message.role), ["user", "assistant"])
    assert.equal(savedPlanChat.learning.phase, "awaiting_plan_confirmation")
    assert.match(savedPlanChat.messages.at(-1)?.content ?? "", /Confirm this plan/)
    assert.ok((savedPlanChat.messages.at(-1)?.durationMs ?? 0) > 0, "Host-generated confirmation retains the measured duration")
    const plan = workspace.stateSnapshot.scratchpads.find((scratchpad) => scratchpad.title === "Vector spaces plan")
    assert.ok(plan)
    assert.equal(plan.planConfirmed, false)
    assert.equal(plan.state?.type === "topic" && plan.state.content.length, 3)
    assert.deepEqual(plan.state?.type === "topic" && plan.state.document?.blocks, [])
    assert.equal(plan.materials.length, 2)
    assert.equal(plan.state?.type === "topic" && plan.state.threadTutors.every((thread) => Object.keys(thread.progress).length === 0), true)
    console.log("PASS: 70-page PDF + practice PDF → indexed sections → one planner → host confirmation → committed plan → confirmation reply")
    for (const mode of ["plain", "explicit", "upload", "empty"] as const) {
      const greeting = newChat(runner.id)
      greeting.ownerScratchpadId = plan.id
      if (mode === "upload" || mode === "empty") greeting.materials = [planMaterials[0]]
      await workspace.mutate((state) => state.chats.push(greeting))
      let materialIds: string[] | undefined
      if (mode === "explicit") materialIds = [plan.materials[1].id]
      if (mode === "empty") materialIds = []
      await manager.send({ chatId: greeting.id, content: "Greeting existing topic", openedScratchpadId: plan.id, materialIds })
      const saved = workspace.chat(greeting.id).messages[0]
      let expected: string[] = []
      if (mode === "explicit") expected = [plan.materials[1].id]
      if (mode === "upload") expected = [planMaterials[0].id]
      assert.deepEqual(saved.materialIds, expected, `${mode}: new threads must attach only supplied materials, without automatically attaching topic assets`)
      assert.deepEqual(saved.scratchpadIds, [plan.id], "The opened topic must remain available as context")
      for (let attempt = 0; attempt < 400; attempt++) {
        const runtime = manager.statuses.find((runtime) => runtime.chatId === greeting.id)
        assert.notEqual(runtime?.status, "error", runtime?.error ?? "Greeting failed")
        if (runtime?.status === "ready") break
        await setTimeout(25)
      }
      assert.equal(workspace.chat(greeting.id).messages.at(-1)?.content, "Hello!")
    }
    console.log("PASS: new topic threads preserve context without auto-attaching assets; explicit attachments and uploads still work")
    const unrelatedDraft = newScratchpad("Unrelated unconfirmed topic")
    await workspace.mutate((state) => {
      state.scratchpads.push(unrelatedDraft)
      state.chats.find((chat) => chat.id === planChat.id)!.messages[0].scratchpadIds.push(unrelatedDraft.id)
    })
    await manager.send({ chatId: planChat.id, content: "Start the confirmed topic", confirmScratchpadId: plan.id, openedScratchpadId: plan.id })
    const teachingTurnId = manager.statuses.find((runtime) => runtime.chatId === planChat.id)?.turnId
    assert.ok(teachingTurnId)
    for (let attempt = 0; attempt < 400; attempt++) {
      const runtime = manager.statuses.find((runtime) => runtime.chatId === planChat.id)
      assert.notEqual(runtime?.status, "error", runtime?.error ?? "Confirmed teaching failed")
      if (runtime?.status === "ready") break
      await setTimeout(25)
    }
    const taught = workspace.scratchpad(plan.id)
    assert.equal(taught.planConfirmed, true)
    assert.equal(taught.state?.type === "topic" && taught.state.threadTutors.some((thread) => thread.progress["tp-section-1"]?.steps.length === 1), true)
    assert.equal(workspace.chat(planChat.id).learning.phase, "awaiting_answer")
    assert.equal(new TutorWorkflowRepository(workspace).get(planChat.id, teachingTurnId).nativeInvocations.length, 1, "Confirmed teaching must reach its isolated role without a routing model or final Tutor rewrite")
    assert.ok(runtimeUpdates > fullUpdates, "Tool activity and diagnostics must use runtime updates instead of full workspace snapshots")
    console.log("PASS: learner confirms plan → Tutor assumes topic role → isolated work commits → reply publishes without rewriting")
    console.log(`PASS: ${runtimeUpdates} activity/trace updates use the runtime channel; ${fullUpdates} durable/lifecycle updates use workspace snapshots`)
    const stagedChat = { ...newChat(runner.id), scratchpadRequested: true }
    const otherStagedChat = { ...newChat(runner.id), scratchpadRequested: true }
    await workspace.mutate((state) => { state.chats.push(stagedChat, otherStagedChat) })
    await manager.deleteStagedChat(stagedChat.id)
    assert.equal(workspace.stateSnapshot.chats.some((item) => item.id === stagedChat.id), false)
    assert.equal(workspace.stateSnapshot.chats.some((item) => item.id === otherStagedChat.id), true)
    await assert.rejects(manager.deleteStagedChat(planChat.id), /Only staged threads/)
    assert.equal(workspace.chat(planChat.id).ownerScratchpadId, plan.id)
    const reloaded = new WorkspaceRepository(directory)
    await reloaded.load()
    assert.equal(reloaded.stateSnapshot.chats.some((item) => item.id === stagedChat.id), false)
    assert.equal(reloaded.stateSnapshot.chats.some((item) => item.id === otherStagedChat.id), true)
    console.log("PASS: deleting a staged thread persists, preserves other threads, and rejects promoted threads")
    let preload = resolve(".test-out/preload/index.js")
    if (process.argv[2]) preload = join(dirname(process.argv[2]), "../preload/index.js")
    const renderer = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
    ipcMain.handle(Channel.snapshot, () => ({ runners: workspace.publicRunners, scratchpads: workspace.publicTopics, chats: workspace.publicChats, runtime: manager!.statuses, connected: true, providers: [] }))
    try {
      await renderer.loadURL("data:text/html,<title>EdU runtime bridge test</title>")
      const snapshot = SnapshotSchema.parse(await renderer.webContents.executeJavaScript("window.edu.snapshot()"))
      assert.ok(snapshot.chats.some((saved) => saved.id === planChat.id))
      await renderer.webContents.executeJavaScript("window.runtimeReceived = new Promise(resolve => window.edu.subscribeRuntime(resolve)); true")
      let reply = ""
      const updates = createBatchedUpdate(() => renderer.webContents.send(Channel.runtimeUpdate, { runtime: [{ runnerId: runner.id, chatId: planChat.id, status: "running", activity: "Streaming", reply }] }))
      for (let index = 0; index < 1000; index++) {
        reply = `Token ${index}`
        updates.schedule()
      }
      updates.flush()
      const received = RuntimeUpdateSchema.parse(await renderer.webContents.executeJavaScript("window.runtimeReceived"))
      assert.equal(received.runtime[0].reply, "Token 999")
      assert.deepEqual(Object.keys(received), ["runtime"])
      console.log("PASS: the sandboxed preload loads snapshots and receives the latest batched runtime update without workspace data")
    } finally {
      ipcMain.removeHandler(Channel.snapshot)
      renderer.destroy()
    }
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    await manager?.shutdown()
    await rm(directory, { recursive: true, force: true })
    app.exit(exitCode)
  }
}

void main().catch((error) => { console.error(error); app.exit(1) })
