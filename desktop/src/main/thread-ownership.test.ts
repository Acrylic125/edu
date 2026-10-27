import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { WorkspaceSchema, MessageSchema } from "../shared/contracts"
import { applyScratchpadMutation } from "./state-service"
import { newChat, newScratchpad } from "./workspace"

for (const type of ["topic", "test", "generic"] as const) {
  test(`${type} creation assigns an unowned thread and never transfers an existing owner`, () => {
    const chat = newChat(randomUUID())
    const workspace = WorkspaceSchema.parse({ version: 2, chats: [chat], scratchpads: [], runners: [] })
    const thread = workspace.chats[0]
    const template = newScratchpad("First", type).state!
    const id = randomUUID()
    if (template.type === "topic") {
      applyScratchpadMutation(workspace, thread.id, { type: "createTopic", scratchpadId: id, scratchpad: template })
    } else if (template.type === "test") {
      applyScratchpadMutation(workspace, thread.id, { type: "createTest", scratchpadId: id, test: template })
    } else {
      applyScratchpadMutation(workspace, thread.id, { type: "createGeneric", scratchpadId: id, generic: template })
    }
    assert.equal(thread.ownerScratchpadId, id)
    const referenced = newScratchpad("Referenced", "generic")
    workspace.scratchpads.push(referenced)
    thread.messages.push(MessageSchema.parse({ id: randomUUID(), role: "user", content: "Use this scratchpad", createdAt: new Date().toISOString(), scratchpadIds: [referenced.id] }))
    applyScratchpadMutation(workspace, thread.id, { type: "updateGeneric", scratchpadId: referenced.id, name: "Updated reference" })
    assert.equal(thread.ownerScratchpadId, id)
    applyScratchpadMutation(workspace, thread.id, { type: "createGeneric", scratchpadId: randomUUID(), generic: { type: "generic", version: "19-10-2026", name: "Second", references: [] } })
    assert.equal(thread.ownerScratchpadId, id)
    assert.equal(WorkspaceSchema.parse(JSON.parse(JSON.stringify(workspace))).chats[0].ownerScratchpadId, id)
  })
}
