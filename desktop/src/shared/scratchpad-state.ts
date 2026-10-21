import { z } from "zod"
import { TopicMutationSchema, TopicPartIdSchema, TopicPartSchema, TopicReferenceSchema, TopicStateSchema } from "./topic-state"
import { ContentBlockIdSchema, ContentChangesSchema, ContentDocumentSchema } from "./content-document"

export const ScratchpadTypeSchema = z.enum(["topic", "test", "generic"])
export const TestQuestionSchema = z.object({
  reference: z.array(TopicReferenceSchema).max(1000),
  title: z.string().trim().min(1).max(1000).regex(/^[^\r\n]+$/),
  goals: TopicPartSchema.shape.goals,
  threadWriters: z.array(z.string().min(1).max(200)),
  question: z.string().trim().min(1).max(30_000),
  answer: z.string().max(30_000).optional(),
  mistakes: TopicPartSchema.shape.mistakes,
})
export const CreateTestQuestionInputSchema = TestQuestionSchema.omit({ threadWriters: true, answer: true }).strict()
export const TestStateSchema = z.object({
  type: z.literal("test"),
  version: z.literal("19-10-2026"),
  createdAt: z.iso.datetime(),
  name: TopicStateSchema.shape.name,
  revision: TopicStateSchema.shape.revision,
  document: ContentDocumentSchema.optional(),
  goals: TopicPartSchema.shape.goals,
  questions: z.array(TestQuestionSchema).max(1000),
  references: z.array(TopicReferenceSchema).max(1000),
  content: TopicStateSchema.shape.content,
}).superRefine((state, ctx) => {
  const content = TopicStateSchema.safeParse({ ...state, type: "topic", version: "11-10-2026", threadTutors: [] })
  if (!content.success) for (const issue of content.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
  if (new Set(state.questions.map((question) => question.title)).size !== state.questions.length)
    ctx.addIssue({ code: "custom", message: "Question titles must be unique. Use a new title for a later attempt." })
  for (const question of state.questions) {
    if (new Set(question.threadWriters).size !== question.threadWriters.length)
      ctx.addIssue({ code: "custom", message: "Question writer IDs must be unique." })
  }
})
export const GenericStateSchema = z.object({
  type: z.literal("generic"),
  version: z.literal("19-10-2026"),
  createdAt: z.iso.datetime(),
  name: TopicStateSchema.shape.name,
  references: z.array(TopicReferenceSchema).max(1000),
})
export const ScratchpadStateSchema = z.discriminatedUnion("type", [TopicStateSchema, TestStateSchema, GenericStateSchema])
export const CreateTestInputSchema = z.object(TestStateSchema.shape).omit({ createdAt: true, questions: true, revision: true, document: true }).extend({
  questions: z.array(CreateTestQuestionInputSchema).max(1000),
})
export const CreateGenericInputSchema = GenericStateSchema.omit({ createdAt: true })
const TargetSchema = z.object({ topicId: z.uuid() })
const TestMutations = [
  TargetSchema.extend({ type: z.literal("createTest"), test: CreateTestInputSchema, materialIds: z.array(z.uuid()).optional() }),
  TargetSchema.extend({ type: z.literal("addTestQuestion"), question: CreateTestQuestionInputSchema, materialIds: z.array(z.uuid()).optional() }),
  TargetSchema.extend({ type: z.literal("recordTestAnswer"), title: TestQuestionSchema.shape.title, answer: z.string().max(30_000) }),
  TargetSchema.extend({ type: z.literal("documentTestMistake"), topicPartId: TopicPartIdSchema, context: TopicPartSchema.shape.mistakes.element.shape.context, issue: TopicPartSchema.shape.mistakes.element.shape.issue }),
  TargetSchema.extend({ type: z.literal("updateTest"), name: TestStateSchema.shape.name.optional(), goals: TestStateSchema.shape.goals.optional(), references: TestStateSchema.shape.references.optional(), content: TestStateSchema.shape.content.optional(), expectedState: TestStateSchema.optional(), materialIds: z.array(z.uuid()).optional() }),
  TargetSchema.extend({ type: z.literal("editTestContent"), changes: ContentChangesSchema, present: z.array(ContentBlockIdSchema).min(1).max(100).optional().describe("Ordered stored block IDs to render in this chat reply."), expectedRevision: z.number().int().nonnegative().optional() }),
] as const
const GenericMutations = [
  TargetSchema.extend({ type: z.literal("createGeneric"), generic: CreateGenericInputSchema, materialIds: z.array(z.uuid()).optional() }),
  TargetSchema.extend({ type: z.literal("addGenericReference"), reference: TopicReferenceSchema, materialIds: z.array(z.uuid()).optional() }),
  TargetSchema.extend({ type: z.literal("updateGeneric"), name: GenericStateSchema.shape.name.optional(), summary: z.string().max(200_000).optional(), expectedSummary: z.string().optional() }),
] as const
export const ScratchpadMutationSchema = z.discriminatedUnion("type", [...TopicMutationSchema.options, ...TestMutations, ...GenericMutations])
export const ScratchpadTransactionSchema = z.object({ operations: z.array(ScratchpadMutationSchema) })

export function scratchpadReferences(state: z.infer<typeof ScratchpadStateSchema>) {
  if (state.type === "generic") return state.references
  const references = state.content.flatMap((part) => part.references)
  if (state.type === "topic") return references
  return [...state.references, ...references, ...state.questions.flatMap((question) => question.reference)]
}

export function testScratchpadMarkdown(state: z.infer<typeof TestStateSchema>) {
  const sections = state.questions.map((question) => {
    let text = `## ${question.title}\n${question.question}`
    if (question.answer !== undefined) text += `\n\n### You answered\n${question.answer}`
    return text
  })
  return `# ${state.name}\n\n${sections.join("\n\n")}`
}
