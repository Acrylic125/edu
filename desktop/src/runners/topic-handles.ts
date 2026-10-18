import { z } from "zod"
import type { WorkerJob } from "../shared/contracts"

// Native providers retain tool schemas throughout a turn, including after createTopic adds a handle.
export const TopicHandleSchema = z.string().regex(/^topic_[1-9][0-9]*$/)
  .describe("Use the topic_N handle from the topic directory. UUIDs are internal and are not accepted.")

export function createTopicHandles(job: WorkerJob) {
  const ids = [...new Set([...job.chat.topicHandles, ...job.topics.map((topic) => topic.id), ...job.workspaceTopics.map((topic) => topic.id)])]
  const readable = new Set([...job.topics, ...job.workspaceTopics].map((topic) => topic.id))
  const writable = new Set(job.topics.map((topic) => topic.id))
  const handles = new Map(ids.map((id, index) => [id, `topic_${index + 1}`]))
  return {
    handle(id: string) {
      const handle = handles.get(id)
      if (!handle) throw new Error("Topic is missing its session handle.")
      return handle
    },
    register(id: string) {
      if (!handles.has(id)) {
        ids.push(id)
        handles.set(id, `topic_${ids.length}`)
      }
      readable.add(id)
      writable.add(id)
    },
    resolve(value: z.infer<ReturnType<typeof z.json>>, write: boolean) {
      const allowed = write ? writable : readable
      const handle = TopicHandleSchema.safeParse(value)
      if (handle.success) {
        const id = ids[Number(handle.data.slice("topic_".length)) - 1]
        if (id && allowed.has(id)) return id
      }
      const targets = [...allowed].map((id) => handles.get(id)).join(", ") || "none"
      let access = "read"
      if (write) access = "write"
      throw new Error(`Invalid topic handle or topic is not available for ${access}. Allowed ${access} targets: ${targets}. Use these handles, not UUIDs.`)
    },
    modelText(text: string) {
      return text.replace(/edu-topic:\/\/([a-f0-9-]{36})(?![a-f0-9-])/gi, (url, id: string) => {
        const handle = handles.get(id)
        if (!handle) return url
        return `edu-topic://${handle}`
      })
    },
    storageText(text: string) {
      return text.replace(/edu-topic:\/\/(topic_[1-9][0-9]*)(?![a-zA-Z0-9_-])/g, (url, handle: string) => {
        const id = ids[Number(handle.slice("topic_".length)) - 1]
        if (!id) return url
        return `edu-topic://${id}`
      })
    },
  }
}
