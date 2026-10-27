import { z } from "zod"
import { ContentBlockIdSchema, ContentChangesSchema, ContentDocumentSchema } from "./content-document"

export const ScratchpadNameSchema = z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/)
export const TopicPartIdSchema = z.string().max(150).regex(/^tp-[a-zA-Z0-9-]+$/)
const RelativePathSchema = z.string().min(1).max(4096).refine(
  (path) => !path.startsWith("/") && !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."),
  "References must be relative to scratchpad.state.json and stay inside the scratchpad folder.",
)
const PageRangeSchema = z.object({ from: z.number().int().positive(), to: z.number().int().positive() })
  .refine((range) => range.to >= range.from, "Page ranges must be in ascending order.")
export const TopicReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pdf"), path: RelativePathSchema, pages: z.array(PageRangeSchema).min(1).max(1000) }),
  z.object({ type: z.literal("ppt"), path: RelativePathSchema, pages: z.array(PageRangeSchema).min(1).max(1000) }),
  z.object({ type: z.literal("image"), path: RelativePathSchema }),
  z.object({ type: z.literal("other-file"), path: RelativePathSchema }),
  z.object({ type: z.literal("topic"), id: z.uuid() }),
  z.object({ type: z.literal("website"), url: z.url({ protocol: /^https?$/ }) }),
])
export const TopicPartSchema = z.object({
  id: TopicPartIdSchema,
  parent: z.object({ id: TopicPartIdSchema }).optional(),
  name: z.string().trim().min(1).max(1000),
  references: z.array(TopicReferenceSchema).max(1000),
  goals: z.array(z.object({
    objective: z.string().trim().min(1).max(10_000),
    understoodWhen: z.array(z.string().trim().min(1).max(10_000)).min(1).max(100),
  })),
  mistakes: z.array(z.object({ context: z.string().trim().min(1).max(20_000), issue: z.string().trim().min(1).max(20_000) })),
})
export const PartProgressSchema = z.object({
  status: z.enum(["active", "completed"]),
  steps: z.array(z.object({ question: z.string().trim().min(1).max(30_000), answerFromUser: z.string().max(30_000).optional() })),
})
export const TopicStateSchema = z.object({
  type: z.literal("topic"),
  version: z.literal("11-10-2026"),
  createdAt: z.iso.datetime(),
  name: ScratchpadNameSchema,
  revision: z.number().int().nonnegative().default(0),
  document: ContentDocumentSchema.optional(),
  content: z.array(TopicPartSchema).max(1000),
  threadTutors: z.array(z.object({ id: z.string().min(1).max(200), progress: z.record(TopicPartIdSchema, PartProgressSchema) })),
}).superRefine((state, ctx) => {
  const ids = new Set(state.content.map((part) => part.id))
  if (ids.size !== state.content.length) ctx.addIssue({ code: "custom", message: "Topic part IDs must be unique." })
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
  for (const block of state.document?.blocks ?? []) {
    if ("sectionId" in block && block.sectionId && !ids.has(block.sectionId))
      ctx.addIssue({ code: "custom", message: `Content refers to a missing section: ${block.sectionId}` })
  }
})

export const TopicMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activatePart"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema }),
  z.object({ type: z.literal("complete"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema }),
  z.object({ type: z.literal("documentMistake"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, context: TopicPartSchema.shape.mistakes.element.shape.context, issue: TopicPartSchema.shape.mistakes.element.shape.issue }),
  z.object({ type: z.literal("recordQuestion"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, question: PartProgressSchema.shape.steps.element.shape.question }),
  z.object({ type: z.literal("recordAnswer"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, answerFromUser: z.string().max(30_000), stepIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal("updateTopic"), scratchpadId: z.uuid(), name: TopicStateSchema.shape.name.optional(), content: TopicStateSchema.shape.content.optional(), materialIds: z.array(z.uuid()).optional(), expectedContent: TopicStateSchema.shape.content.optional() }).strict(),
  z.object({ type: z.literal("editTopicContent"), scratchpadId: z.uuid(), changes: ContentChangesSchema, present: z.array(ContentBlockIdSchema).min(1).max(100).optional().describe("Ordered stored block IDs to render in this chat reply. The app uses their saved content as the explanation."), expectedRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("createTopic"), createdAt: z.iso.datetime().optional(), scratchpadId: z.uuid(), scratchpad: z.object(TopicStateSchema.shape).omit({ createdAt: true, threadTutors: true, revision: true, document: true }), materialIds: z.array(z.uuid()).optional() }),
])

export function freshTopicState(name: string, createdAt: string) {
  return TopicStateSchema.parse({ type: "topic", version: "11-10-2026", createdAt, name, document: { version: 1, blocks: [] }, content: [], threadTutors: [] })
}
