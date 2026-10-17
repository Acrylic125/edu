import { z } from "zod"

export const TopicPartIdSchema = z.string().regex(/^tp-[a-zA-Z0-9-]+$/)
const RelativePathSchema = z.string().min(1).max(4096).refine(
  (path) => !path.startsWith("/") && !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."),
  "References must be relative to topic.state.json and stay inside the topic folder.",
)
const PageRangeSchema = z.object({ from: z.number().int().positive(), to: z.number().int().positive() })
  .refine((range) => range.to >= range.from, "Page ranges must be in ascending order.")
export const TopicReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pdf"), path: RelativePathSchema, pages: z.array(PageRangeSchema).min(1).max(1000) }),
  z.object({ type: z.literal("ppt"), path: RelativePathSchema, pages: z.array(PageRangeSchema).min(1).max(1000) }),
  z.object({ type: z.literal("image"), path: RelativePathSchema }),
  z.object({ type: z.literal("website"), url: z.url({ protocol: /^https?$/ }) }),
])
export const TopicPartSchema = z.object({
  id: TopicPartIdSchema,
  get parent() { return TopicPartSchema.optional() },
  name: z.string().trim().min(1).max(1000),
  references: z.array(TopicReferenceSchema).max(1000),
  goals: z.object({
    id: z.string().regex(/^tpg-[a-zA-Z0-9-]+$/),
    objective: z.string().trim().min(1).max(10_000),
    understoodWhen: z.array(z.string().trim().min(1).max(10_000)).min(1).max(100),
  }),
  mistakes: z.array(z.object({ context: z.string().trim().min(1).max(20_000), issue: z.string().trim().min(1).max(20_000) })),
})
export const PartProgressSchema = z.object({
  status: z.enum(["active", "completed"]),
  steps: z.array(z.object({ question: z.string().trim().min(1).max(30_000), answerFromUser: z.string().max(30_000).optional() })),
})
export const TopicStateSchema = z.object({
  version: z.literal("11-10-2026"),
  createdAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(150),
  content: z.array(TopicPartSchema).max(1000),
  threadTutors: z.array(z.object({ id: z.string().min(1).max(200), progress: z.record(TopicPartIdSchema, PartProgressSchema) })),
}).superRefine((state, ctx) => {
  const ids = new Set(state.content.map((part) => part.id))
  if (ids.size !== state.content.length) ctx.addIssue({ code: "custom", message: "Topic part IDs must be unique." })
  const goals = new Set(state.content.map((part) => part.goals.id))
  if (goals.size !== state.content.length) ctx.addIssue({ code: "custom", message: "Goal IDs must be unique." })
  const threads = new Set(state.threadTutors.map((thread) => thread.id))
  if (threads.size !== state.threadTutors.length) ctx.addIssue({ code: "custom", message: "Tutor thread IDs must be unique." })
  for (const part of state.content) {
    const seen = new Set([part.id])
    let parent = part.parent
    while (parent) {
      if (!ids.has(parent.id) || seen.has(parent.id)) {
        ctx.addIssue({ code: "custom", message: "Part parents must exist in content and cannot form a cycle." })
        break
      }
      seen.add(parent.id)
      parent = state.content.find((entry) => entry.id === parent?.id)?.parent
    }
  }
  for (const thread of state.threadTutors) {
    for (const id of Object.keys(thread.progress)) {
      if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `Progress refers to a missing part: ${id}` })
    }
  }
})

export const TopicMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activatePart"), topicId: z.uuid(), topicPartId: TopicPartIdSchema }),
  z.object({ type: z.literal("complete"), topicId: z.uuid(), topicPartId: TopicPartIdSchema }),
  z.object({ type: z.literal("documentMistake"), topicId: z.uuid(), topicPartId: TopicPartIdSchema, context: TopicPartSchema.shape.mistakes.element.shape.context, issue: TopicPartSchema.shape.mistakes.element.shape.issue }),
  z.object({ type: z.literal("recordQuestion"), topicId: z.uuid(), topicPartId: TopicPartIdSchema, question: PartProgressSchema.shape.steps.element.shape.question }),
  z.object({ type: z.literal("recordAnswer"), topicId: z.uuid(), topicPartId: TopicPartIdSchema, answerFromUser: z.string().max(30_000), stepIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal("updateTopic"), topicId: z.uuid(), name: TopicStateSchema.shape.name.optional(), content: TopicStateSchema.shape.content.optional(), summary: z.string().max(200_000).optional(), materialIds: z.array(z.uuid()).optional(), expectedSummary: z.string().optional(), expectedContent: TopicStateSchema.shape.content.optional() }),
  z.object({ type: z.literal("createTopic"), topicId: z.uuid(), topic: z.object(TopicStateSchema.shape).omit({ createdAt: true, threadTutors: true }), materialIds: z.array(z.uuid()).optional() }),
])

export const TopicToolNames = ["getMistakesForTopic", "whereAmI", "whatIsNext", "getQuestions", "documentMistake", "complete", "activatePart", "createTopic", "updateTopic", "recordQuestion", "recordAnswer"] as const

export function freshTopicState(name: string, createdAt: string) {
  return TopicStateSchema.parse({ version: "11-10-2026", createdAt, name, content: [], threadTutors: [] })
}
