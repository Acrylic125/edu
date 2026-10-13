import { expect, test } from "vitest"
import { createChatTabs } from "../src/renderer/chat-tabs"

test("an empty workspace has no chat tabs or view history", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile([])
  expect(tabs.getState().activeId).toBe("new")
  expect(tabs.getState().openIds).toEqual([])
  expect(tabs.getState().history).toEqual([])
})

test("restoring legacy tabs removes new topic from tabs and chat history", () => {
  const tabs = createChatTabs({
    getItem: () => JSON.stringify({
      openIds: ["A", "B", "new-topic"],
      history: ["new-topic", "B", "A"],
    }),
    setItem: () => {},
  })
  tabs.getState().reconcile(["A", "B"])
  expect(tabs.getState().activeId).toBe("B")
  expect(tabs.getState().openIds).toEqual(["A", "B"])
  expect(tabs.getState().history).toEqual(["B", "A"])
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("A")
  tabs.getState().commitCycle()
})

test("creating a topic opens its conversation without duplicate tabs", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["A", "B"])
  tabs.getState().select("B")
  tabs.getState().reconcile(["A", "B", "C"])
  tabs.getState().select("C")
  expect(tabs.getState().activeId).toBe("C")
  expect(tabs.getState().openIds).toEqual(["A", "B", "C"])
  expect(tabs.getState().history).toEqual(["C", "B", "A"])
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("B")
})

test("restoring an empty legacy new-topic tab leaves no chat history", () => {
  const tabs = createChatTabs({
    getItem: () => JSON.stringify({ openIds: ["new-topic"], history: ["new-topic"] }),
    setItem: () => {},
  })
  tabs.getState().reconcile([])
  expect(tabs.getState().openIds).toEqual([])
  expect(tabs.getState().history).toEqual([])
  expect(tabs.getState().activeId).toBe("new")
})

test("separate Ctrl+Tab presses toggle the two most recently viewed chats", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["A", "B", "C"])
  tabs.getState().select("A")
  tabs.getState().select("B")
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("A")
  tabs.getState().commitCycle()
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("B")
  tabs.getState().commitCycle()
  expect(tabs.getState().history).toEqual(["B", "A"])
})

test("holding Ctrl freezes history while repeats traverse it in both directions", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["A", "B", "C"])
  for (const id of ["A", "B", "C"]) tabs.getState().select(id)
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("B")
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("A")
  tabs.getState().cycle(true)
  expect(tabs.getState().activeId).toBe("B")
  expect(tabs.getState().history).toEqual(["C", "B", "A"])
  tabs.getState().commitCycle()
  expect(tabs.getState().history).toEqual(["B", "C", "A"])
  tabs.getState().cycle(true)
  expect(tabs.getState().activeId).toBe("A")
})

test("closing chooses the latest surviving chat and reopening restores its tab", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["A", "B", "C"])
  for (const id of ["B", "A", "C"]) tabs.getState().select(id)
  tabs.getState().close("C")
  expect(tabs.getState().activeId).toBe("A")
  tabs.getState().close("B")
  expect(tabs.getState().activeId).toBe("A")
  tabs.getState().reconcile(["A", "B", "C"])
  expect(tabs.getState().openIds).toEqual(["A"])
  tabs.getState().select("C")
  expect(tabs.getState().openIds).toEqual(["A", "C"])
  expect(tabs.getState().history).toEqual(["C", "A"])
})

test("restores viewed history and closed tabs without reopening them on snapshots", () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
  const tabs = createChatTabs(storage)
  tabs.getState().reconcile(["A", "B", "C"])
  tabs.getState().select("B")
  tabs.getState().select("C")
  tabs.getState().close("A")
  const restored = createChatTabs(storage)
  restored.getState().reconcile(["A", "B", "C"])
  expect(restored.getState().activeId).toBe("C")
  expect(restored.getState().openIds).toEqual(["B", "C"])
  restored.getState().cycle(false)
  expect(restored.getState().activeId).toBe("B")
  // A restart during a held-key preview restores the last committed selection.
  const interrupted = createChatTabs(storage)
  interrupted.getState().reconcile(["A", "B", "C"])
  expect(interrupted.getState().activeId).toBe("C")
  restored.getState().commitCycle()
  const committed = createChatTabs(storage)
  committed.getState().reconcile(["A", "B", "C"])
  expect(committed.getState().activeId).toBe("B")
})

test("prunes missing chats, admits newly created chats, and falls back to a new draft", () => {
  const tabs = createChatTabs()
  tabs.getState().reconcile(["A", "B"])
  tabs.getState().select("B")
  tabs.getState().reconcile(["A", "C"])
  expect(tabs.getState().activeId).toBe("A")
  expect(tabs.getState().openIds).toEqual(["A", "C"])
  expect(tabs.getState().history).toEqual(["A"])
  tabs.getState().close("A")
  tabs.getState().close("C")
  expect(tabs.getState().activeId).toBe("new")
  expect(tabs.getState().openIds).toEqual(["new"])
  tabs.getState().cycle(false)
  expect(tabs.getState().activeId).toBe("new")
})

test.each([
  "not json",
  '{"openIds":42,"history":[]}',
  '{"openIds":[null],"history":["A"]}',
])("ignores invalid saved state: %s", (raw) => {
  const tabs = createChatTabs({ getItem: () => raw, setItem: () => {} })
  tabs.getState().reconcile(["A", "B"])
  expect(tabs.getState().openIds).toEqual(["A", "B"])
  expect(tabs.getState().activeId).toBe("A")
})

test("navigation works when browser storage is disabled", () => {
  const tabs = createChatTabs({
    getItem: () => {
      throw new Error("disabled")
    },
    setItem: () => {
      throw new Error("disabled")
    },
  })
  tabs.getState().reconcile(["A", "B"])
  tabs.getState().select("B")
  tabs.getState().cycle(false)
  tabs.getState().commitCycle()
  expect(tabs.getState().activeId).toBe("A")
})
