import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { SendSchema } from "./contracts"

test("attachment-only messages require explicit material IDs", () => {
  const chatId = randomUUID()
  assert.equal(SendSchema.safeParse({ chatId, content: "", materialIds: [randomUUID()] }).success, true)
  assert.equal(SendSchema.safeParse({ chatId, content: "" }).success, false)
  assert.equal(SendSchema.safeParse({ chatId, content: "   ", materialIds: [] }).success, false)
  assert.equal(SendSchema.safeParse({ chatId, content: "Check this" }).success, true)
})
