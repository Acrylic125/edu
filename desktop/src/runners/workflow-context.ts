import { join, dirname } from "node:path"
import { z } from "zod"
import { WorkflowRecordSchema } from "../shared/tutor-workflow"

export function committedSource(turn: z.infer<typeof WorkflowRecordSchema>) {
  const source = structuredClone(turn.source)
  for (const batch of turn.batches) {
    if (!batch.receipt) continue
    for (const job of batch.jobs) {
      if (!job.committedSnapshot) continue
      const target = job.committedSnapshot
      const writable = source.scratchpads.some((scratchpad) => scratchpad.id === target.id)
      source.scratchpads = source.scratchpads.filter((scratchpad) => scratchpad.id !== target.id)
      if (writable || job.access === "write" || job.mode === "create") source.scratchpads.push({ ...target, assetDirectory: join(dirname(dirname(source.assetDirectory)), "..", "scratchpads", target.id, "assets") })
      source.workspaceScratchpads = source.workspaceScratchpads.filter((scratchpad) => scratchpad.id !== target.id)
      source.workspaceScratchpads.push({ ...target, notes: target.learning.notes })
      if (!source.chat.scratchpadHandles.includes(target.id)) source.chat.scratchpadHandles.push(target.id)
      if (job.mode === "create") source.chat.scratchpadRequested = false
    }
  }
  source.chat.providerSession = undefined
  const covered = source.chat.messages.findIndex((message) => message.id === turn.summary?.coveredThroughMessageId)
  source.chat.messages = source.chat.messages.slice(covered + 1)
  return source
}

