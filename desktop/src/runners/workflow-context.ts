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
      const writable = source.topics.some((topic) => topic.id === target.id)
      source.topics = source.topics.filter((topic) => topic.id !== target.id)
      if (writable || job.access === "write" || job.mode === "create") source.topics.push({ ...target, assetDirectory: join(dirname(dirname(source.assetDirectory)), "..", "scratchpads", target.id, "assets") })
      source.workspaceTopics = source.workspaceTopics.filter((topic) => topic.id !== target.id)
      source.workspaceTopics.push({ ...target, notes: target.learning.notes })
      if (!source.chat.topicHandles.includes(target.id)) source.chat.topicHandles.push(target.id)
      if (job.mode === "create") source.chat.scratchpadRequested = false
    }
  }
  source.chat.providerSession = undefined
  const covered = source.chat.messages.findIndex((message) => message.id === turn.summary?.coveredThroughMessageId)
  source.chat.messages = source.chat.messages.slice(covered + 1)
  return source
}

