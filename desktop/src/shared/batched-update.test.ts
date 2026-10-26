import assert from "node:assert/strict"
import { test } from "node:test"
import { createBatchedUpdate } from "./batched-update"

test("a burst publishes only the latest state and flush preserves the final update", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let latest = ""
  const published: string[] = []
  const updates = createBatchedUpdate(() => published.push(latest))
  for (let index = 0; index < 1000; index++) {
    latest = `Token ${index}`
    updates.schedule()
  }
  assert.equal(published.length, 0)
  t.mock.timers.tick(39)
  assert.equal(published.length, 0)
  t.mock.timers.tick(1)
  assert.deepEqual(published, ["Token 999"])
  updates.flush()
  assert.equal(published.length, 1)
  latest = "Final response"
  updates.schedule()
  updates.flush()
  assert.deepEqual(published, ["Token 999", "Final response"])
  updates.schedule()
  updates.cancel()
  t.mock.timers.tick(40)
  updates.flush()
  assert.equal(published.length, 2)
})
