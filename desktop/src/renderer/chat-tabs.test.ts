import assert from "node:assert/strict"
import { test } from "node:test"
import { createChatTabs } from "./chat-tabs"

test("scratchpads retain separate tabs, selection, and keyboard history", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["a1", "a2"], "a")
  tabs.getState().select("a2")
  tabs.getState().close("a1")
  tabs.getState().reconcile(["b1", "b2"], "b")
  assert.deepEqual(tabs.getState().openIds, ["b1", "b2"])
  tabs.getState().cycle(false)
  assert.equal(tabs.getState().activeId, "b2")
  tabs.getState().reconcile(["a1", "a2"], "a")
  assert.deepEqual(tabs.getState().openIds, ["a2"])
  assert.equal(tabs.getState().activeId, "a2")
  tabs.getState().cycle(false)
  assert.equal(tabs.getState().activeId, "a2")
  tabs.getState().reconcile([], undefined)
  assert.deepEqual(tabs.getState().openIds, [])
  assert.equal(tabs.getState().activeId, "new")
})

test("scratchpad tab state survives reloads and removes deleted threads", () => {
  const saved = new Map<string, string>()
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } }
  const tabs = createChatTabs(storage)
  tabs.getState().reconcile(["a1", "a2"], "a")
  tabs.getState().select("a2")
  tabs.getState().reconcile(["b1"], "b")
  const reloaded = createChatTabs(storage)
  reloaded.getState().reconcile(["a1", "a2"], "a")
  assert.equal(reloaded.getState().activeId, "a2")
  reloaded.getState().reconcile(["a1"], "a")
  assert.deepEqual(reloaded.getState().openIds, ["a1"])
  assert.equal(reloaded.getState().activeId, "a1")
})
