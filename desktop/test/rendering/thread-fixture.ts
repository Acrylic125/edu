import { PublicTopicSchema, type Snapshot } from "../../src/shared/contracts"

export function ownTestThreads(snapshot: Snapshot) {
  const scratchpad = PublicTopicSchema.parse({
    id: crypto.randomUUID(), title: "Thread owner", createdAt: new Date().toISOString(), planConfirmed: true, materials: [],
    learning: { phase: "ready_to_continue", outline: [], currentSection: "", pendingQuestion: "", nextAction: "", notes: "" },
  })
  snapshot.scratchpads.push(scratchpad)
  for (const chat of snapshot.chats) chat.ownerScratchpadId = scratchpad.id
  return scratchpad.id
}
