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
const CriterionReferenceSchema = z.object({
  goalIndex: z.number().int().nonnegative().describe("Zero-based index in the part's existing goals."),
  criterionIndex: z.number().int().nonnegative().describe("Zero-based index in that goal's understoodWhen criteria."),
})
const ResumeCheckSchema = z.object({ threadId: z.string().min(1).max(200), stepIndex: z.number().int().nonnegative() })
export const TopicCheckSchema = CriterionReferenceSchema.extend({
  reasoningTask: z.string().trim().min(1).max(2000).describe("The reasoning the learner must supply, independent of example names and numbers."),
  missingEvidence: z.string().trim().min(1).max(4000).describe("Evidence still missing for this original criterion after crediting previous answers."),
  expectedEvidence: z.string().trim().min(1).max(4000).describe("What this check would reveal that earlier answers did not."),
})
export const TopicAnswerAssessmentSchema = CriterionReferenceSchema.extend({
  status: z.enum(["demonstrated", "uncertain", "contradicted"]),
  evidence: z.array(z.object({ stepIndex: z.number().int().nonnegative(), quote: z.string().max(30_000) })).min(1).max(100)
    .describe("Verbatim complete answers from this thread and part, including the current answer. Keep interpretations in interpretation."),
  interpretation: z.string().trim().min(1).max(4000).describe("Assessment of the cited answers against the original criterion. Unsupported explanations of the learner's reasoning remain uncertain."),
  remainingGap: z.string().max(4000).describe("Specific unresolved conceptual gap, or an empty string when demonstrated. Incidental wording and arithmetic are not new criteria."),
}).superRefine((assessment, ctx) => {
  if (assessment.status === "demonstrated" && assessment.remainingGap.trim())
    ctx.addIssue({ code: "custom", message: "A demonstrated criterion has no remaining gap." })
  if (assessment.status !== "demonstrated" && !assessment.remainingGap.trim())
    ctx.addIssue({ code: "custom", message: "An uncertain or contradicted criterion needs a specific remaining gap." })
})
export const PartProgressSchema = z.object({
  status: z.enum(["active", "completed"]),
  steps: z.array(z.object({
    question: z.string().trim().min(1).max(30_000), answerFromUser: z.string().max(30_000).optional(),
    check: TopicCheckSchema.optional(), assessment: TopicAnswerAssessmentSchema.optional(),
    assessmentHistory: z.array(TopicAnswerAssessmentSchema).optional(),
    assessmentOrder: z.number().int().nonnegative().optional(),
    additionalAnswers: z.array(z.object({ messageId: z.uuid(), answerFromUser: z.string().max(30_000) })).optional(),
    resumeFrom: ResumeCheckSchema.optional(),
    reviewStartIndex: z.number().int().nonnegative().optional(),
  })),
})
export const TopicStateSchema = z.object({
  type: z.literal("topic"),
  version: z.literal("11-10-2026"),
  createdAt: z.iso.datetime(),
  name: ScratchpadNameSchema,
  revision: z.number().int().nonnegative().default(0),
  document: ContentDocumentSchema.optional(),
  content: z.array(TopicPartSchema).max(1000),
  removedParts: z.array(TopicPartSchema).max(1000).optional(),
  threadTutors: z.array(z.object({ id: z.string().min(1).max(200), currentPartId: TopicPartIdSchema.optional(), progress: z.record(TopicPartIdSchema, PartProgressSchema) })),
}).superRefine((state, ctx) => {
  const ids = new Set(state.content.map((part) => part.id))
  if (ids.size !== state.content.length) ctx.addIssue({ code: "custom", message: "Topic part IDs must be unique." })
  const historicalIds = new Set([...(state.removedParts ?? []).map((part) => part.id), ...ids])
  if (historicalIds.size !== state.content.length + (state.removedParts?.length ?? 0)) ctx.addIssue({ code: "custom", message: "Active and removed part IDs must be unique." })
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
      if (!historicalIds.has(id)) ctx.addIssue({ code: "custom", message: `Progress refers to a missing part: ${id}` })
    }
  }
  for (const block of state.document?.blocks ?? []) {
    if ("sectionId" in block && block.sectionId && !historicalIds.has(block.sectionId))
      ctx.addIssue({ code: "custom", message: `Content refers to a missing section: ${block.sectionId}` })
  }
})

export const TopicChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), id: TopicPartIdSchema, patch: TopicPartSchema.omit({ id: true, mistakes: true }).partial().extend({ parent: z.object({ id: TopicPartIdSchema }).nullable().optional() }).strict() }).strict(),
  z.object({ action: z.literal("add"), part: TopicPartSchema, afterId: TopicPartIdSchema.nullable().describe("Insert after this active part; null inserts at the beginning.") }).strict(),
  z.object({ action: z.literal("remove"), id: TopicPartIdSchema }).strict(),
  z.object({ action: z.literal("move"), id: TopicPartIdSchema, afterId: TopicPartIdSchema.nullable() }).strict(),
])

export function applyTopicChanges(source: z.infer<typeof TopicStateSchema>, changes: z.infer<typeof TopicChangeSchema>[]) {
  const state = structuredClone(source)
  for (const change of changes) {
    if (change.action === "add") {
      if ([...state.content, ...(state.removedParts ?? [])].some((part) => part.id === change.part.id))
        throw new Error(`Part ID already exists: ${change.part.id}`)
      const position = change.afterId === null ? -1 : state.content.findIndex((part) => part.id === change.afterId)
      if (change.afterId !== null && position < 0) throw new Error(`Insertion target not found: ${change.afterId}`)
      state.content.splice(position + 1, 0, change.part)
      continue
    }
    const index = state.content.findIndex((part) => part.id === change.id)
    const part = state.content[index]
    if (!part) throw new Error(`Active part not found: ${change.id}`)
    if (change.action === "update") {
      const { parent, ...fields } = change.patch
      const updated = TopicPartSchema.parse({ ...part, ...fields })
      if (parent === null) delete updated.parent
      else if (parent !== undefined) updated.parent = parent
      state.content[index] = updated
      for (const thread of state.threadTutors) {
        const progress = thread.progress[part.id]
        if (!progress || JSON.stringify(part.goals) === JSON.stringify(updated.goals)) continue
        // Index-based assessments remain valid only while their original objective and criterion stay unchanged.
        const preserved = part.goals.every((goal, goalIndex) => updated.goals[goalIndex]?.objective === goal.objective &&
          goal.understoodWhen.every((criterion, criterionIndex) => updated.goals[goalIndex]?.understoodWhen[criterionIndex] === criterion))
        const last = progress.steps.at(-1)
        if (!preserved && last) last.reviewStartIndex = progress.steps.length
        progress.status = "active"
      }
    } else if (change.action === "remove") {
      state.content.splice(index, 1)
      state.removedParts = [...(state.removedParts ?? []), part]
    } else {
      if (change.afterId === change.id) throw new Error("A part cannot be moved after itself.")
      state.content.splice(index, 1)
      const position = change.afterId === null ? -1 : state.content.findIndex((entry) => entry.id === change.afterId)
      if (change.afterId !== null && position < 0) throw new Error(`Move target not found: ${change.afterId}`)
      state.content.splice(position + 1, 0, part)
    }
  }
  for (const thread of state.threadTutors) {
    if (thread.currentPartId && !state.content.some((part) => part.id === thread.currentPartId))
      thread.currentPartId = state.content.find((part) => thread.progress[part.id]?.status !== "completed")?.id
  }
  return TopicStateSchema.parse(state)
}

export const TopicMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activatePart"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema }),
  z.object({ type: z.literal("complete"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, evidenceKey: z.string().length(64).optional() }),
  z.object({ type: z.literal("documentMistake"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, context: TopicPartSchema.shape.mistakes.element.shape.context, issue: TopicPartSchema.shape.mistakes.element.shape.issue }),
  z.object({ type: z.literal("recordQuestion"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, question: PartProgressSchema.shape.steps.element.shape.question, check: TopicCheckSchema.optional(), resumeFrom: ResumeCheckSchema.optional().describe("Resume the exact latest check from another thread in this part. The host copies its question and criterion into the current thread and returns the current thread's pendingCheck. Source history stays unchanged.") }),
  z.object({ type: z.literal("recordAnswer"), scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema, answerFromUser: z.string().max(30_000), stepIndex: z.number().int().nonnegative(), assessment: TopicAnswerAssessmentSchema.optional(), assessmentOrder: z.number().int().nonnegative().optional(), answerMessageId: z.uuid().optional() }),
  z.object({
    type: z.literal("updateTopic"), scratchpadId: z.uuid(), name: TopicStateSchema.shape.name.optional(),
    changes: z.array(TopicChangeSchema).min(1).max(1000).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    // Persisted workflows from earlier builds still replay replacements; model tools accept only explicit changes.
    content: TopicStateSchema.shape.content.optional(), expectedContent: TopicStateSchema.shape.content.optional(),
    materialIds: z.array(z.uuid()).optional(),
  }).strict(),
  z.object({ type: z.literal("editTopicContent"), scratchpadId: z.uuid(), changes: ContentChangesSchema, present: z.array(ContentBlockIdSchema).min(1).max(100).optional().describe("Ordered stored block IDs to render in this chat reply. The app uses their saved content as the explanation."), expectedRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("createTopic"), createdAt: z.iso.datetime().optional(), scratchpadId: z.uuid(), scratchpad: z.object(TopicStateSchema.shape).omit({ createdAt: true, threadTutors: true, revision: true, document: true, removedParts: true }), materialIds: z.array(z.uuid()).optional() }),
])

export function freshTopicState(name: string, createdAt: string) {
  return TopicStateSchema.parse({ type: "topic", version: "11-10-2026", createdAt, name, document: { version: 1, blocks: [] }, content: [], threadTutors: [] })
}
