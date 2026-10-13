import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { createTopicViews } from "../src/renderer/topic-views"

test("restores topic view history independently of creation order and the new-topic screen", () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
  const first = randomUUID()
  const second = randomUUID()
  const views = createTopicViews(storage)
  views.getState().reconcile([first, second])
  expect(views.getState().activeId).toBeUndefined()
  views.getState().select(second)
  views.getState().select(first)
  views.getState().select(second)
  expect(views.getState().history).toEqual([second, first])
  views.getState().select()
  expect(views.getState().activeId).toBeUndefined()
  const restored = createTopicViews(storage)
  restored.getState().reconcile([first, second])
  expect(restored.getState().activeId).toBe(second)
  restored.getState().reconcile([first])
  expect(restored.getState().activeId).toBe(first)
  expect(restored.getState().history).toEqual([first])
  restored.getState().reconcile([])
  expect(restored.getState().activeId).toBeUndefined()
  expect(restored.getState().history).toEqual([])
})

test.each(["not JSON", '["invalid-topic-id"]', '{"history":[]}'])("ignores invalid stored topic history: %s", (raw) => {
  const views = createTopicViews({ getItem: () => raw, setItem: () => {} })
  views.getState().reconcile([randomUUID()])
  expect(views.getState().activeId).toBeUndefined()
  expect(views.getState().history).toEqual([])
})

test("topic navigation works when storage is unavailable", () => {
  const views = createTopicViews({
    getItem: () => { throw new Error("Storage disabled") },
    setItem: () => { throw new Error("Storage disabled") },
  })
  const id = randomUUID()
  views.getState().select(id)
  views.getState().reconcile([id])
  expect(views.getState().activeId).toBe(id)
})
