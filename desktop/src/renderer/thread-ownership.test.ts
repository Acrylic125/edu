import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { SnapshotSchema } from "../shared/contracts"
import { useWorkspace } from "./store"
import { useChatTabs } from "./chat-tabs"
import { createTopicViews, stagingId, useTopicViews } from "./topic-views"

function fixture() {
  const scratchpads = ["First", "Second"].map((title) => ({
    id: randomUUID(), title, createdAt: new Date().toISOString(), planConfirmed: true, materials: [],
    learning: { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes: "" },
  }))
  return SnapshotSchema.parse({
    scratchpads, chats: scratchpads.map((scratchpad) => ({
      id: randomUUID(), ownerScratchpadId: scratchpad.id, runnerId: randomUUID(), title: scratchpad.title,
      createdAt: scratchpad.createdAt, materials: [], messages: [], phase: "ready_to_continue",
    })), runners: [], runtime: [], providers: [], connected: false,
  })
}

test("references do not switch scratchpads or add tabs to another owner", () => {
  const snapshot = fixture()
  useWorkspace.getState().setSnapshot(snapshot)
  useTopicViews.getState().select(snapshot.scratchpads[0].id)
  useChatTabs.getState().select(snapshot.chats[0].id)
  const referenced = structuredClone(snapshot)
  referenced.chats[0].messages.push({ id: randomUUID(), role: "assistant", content: "Reference", createdAt: new Date().toISOString(), scratchpadIds: [snapshot.scratchpads[1].id] })
  useWorkspace.getState().setSnapshot(referenced)
  assert.equal(useTopicViews.getState().activeId, snapshot.scratchpads[0].id)
  assert.deepEqual(useChatTabs.getState().openIds, [snapshot.chats[0].id])
  useTopicViews.getState().select(snapshot.scratchpads[1].id)
  assert.deepEqual(useChatTabs.getState().openIds, [snapshot.chats[1].id])
})

test("a creation thread follows its new owner and remains selected", () => {
  const snapshot = fixture()
  snapshot.chats[0].ownerScratchpadId = undefined
  snapshot.chats[0].scratchpadRequested = true
  useWorkspace.getState().setSnapshot(snapshot)
  useTopicViews.getState().select(stagingId)
  useChatTabs.getState().select(snapshot.chats[0].id)
  const created = structuredClone(snapshot)
  created.chats[0].ownerScratchpadId = created.scratchpads[0].id
  useWorkspace.getState().setSnapshot(created)
  assert.equal(useTopicViews.getState().activeId, created.scratchpads[0].id)
  assert.equal(useChatTabs.getState().activeId, created.chats[0].id)
  assert.deepEqual(useChatTabs.getState().openIds, [created.chats[0].id])
})

test("the active thread follows a creation request moved into Staging", () => {
  const snapshot = fixture()
  const request = { id: randomUUID(), role: "user" as const, content: "Create a test", createdAt: new Date().toISOString(), scratchpadIds: [snapshot.scratchpads[0].id] }
  snapshot.chats[0].messages.push(request)
  useWorkspace.getState().setSnapshot(snapshot)
  useTopicViews.getState().select(snapshot.scratchpads[0].id)
  useChatTabs.getState().select(snapshot.chats[0].id)
  const moved = structuredClone(snapshot)
  moved.chats[0].messages = []
  const staged = { ...moved.chats[0], id: randomUUID(), ownerScratchpadId: undefined, scratchpadRequested: true, messages: [request] }
  moved.chats.push(staged)
  useWorkspace.getState().setSnapshot(moved)
  assert.equal(useTopicViews.getState().activeId, stagingId)
  assert.equal(useChatTabs.getState().activeId, staged.id)
  assert.deepEqual(useChatTabs.getState().openIds, [staged.id])
  assert.equal(useWorkspace.getState().snapshot.chats[0].ownerScratchpadId, snapshot.scratchpads[0].id)
})


test("Staging holds unowned threads separately from New Scratchpad", () => {
  const snapshot = fixture()
  snapshot.chats[0].ownerScratchpadId = undefined
  snapshot.chats[0].scratchpadRequested = true
  useWorkspace.getState().setSnapshot(snapshot)
  useTopicViews.getState().select(stagingId)
  useChatTabs.getState().reconcile([snapshot.chats[0].id], `${stagingId}:${snapshot.chats[0].id}`)
  useChatTabs.getState().select(snapshot.chats[0].id)
  assert.deepEqual(useChatTabs.getState().openIds, [snapshot.chats[0].id])
  useTopicViews.getState().select(undefined)
  assert.deepEqual(useChatTabs.getState().openIds, [])
  useTopicViews.getState().select(stagingId)
  useChatTabs.getState().reconcile([snapshot.chats[0].id], `${stagingId}:${snapshot.chats[0].id}`)
  useChatTabs.getState().select(snapshot.chats[0].id)
  assert.equal(useChatTabs.getState().activeId, snapshot.chats[0].id)
  useWorkspace.getState().setSnapshot({ ...snapshot, chats: snapshot.chats.slice(1) })
  assert.deepEqual(useChatTabs.getState().openIds, [])
  assert.equal(useChatTabs.getState().activeId, "new")
})

test("unbound threads are staged without a separate lifecycle flag", () => {
  const snapshot = fixture()
  snapshot.chats = snapshot.chats.map((chat) => ({ ...chat, ownerScratchpadId: undefined }))
  useWorkspace.getState().setSnapshot(snapshot)
  useTopicViews.getState().select(stagingId)
  assert.deepEqual(useChatTabs.getState().openIds, [])
})

test("old conversations are not unfinished scratchpads", async () => {
  const { isStagedChat } = await import("../shared/thread-ownership")
  const snapshot = fixture()
  const ordinary = { ...snapshot.chats[0], ownerScratchpadId: undefined, scratchpadRequested: false }
  const unfinished = { ...ordinary, scratchpadRequested: true }
  assert.equal(isStagedChat(ordinary), false)
  assert.equal(isStagedChat(unfinished), true)
})


test("opening the app starts on New Scratchpad even after viewing staging", () => {
  const views = createTopicViews({ getItem: () => JSON.stringify([stagingId, randomUUID()]), setItem: () => {} })
  assert.equal(views.getState().activeId, undefined)
})
