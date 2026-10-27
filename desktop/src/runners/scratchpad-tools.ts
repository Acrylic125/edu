import { z } from "zod"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ScratchpadMutationSchema } from "../shared/scratchpad-state"
import { TopicPartIdSchema } from "../shared/topic-state"
import { TopicHandleSchema } from "./topic-handles"

const mutationRoles = {
  editTopicContent: "topic", editTestContent: "test",
  activatePart: "topic", complete: "topic", documentMistake: "topic", recordQuestion: "topic", recordAnswer: "topic", updateTopic: "topic", createTopic: "topic",
  createTest: "test", addTestQuestion: "test", recordTestAnswer: "test", documentTestMistake: "test", updateTest: "test",
  createGeneric: "generic", addGenericReference: "generic", updateGeneric: "generic",
} as const
const mutationNames = {
  editTopicContent: "editContent", editTestContent: "editContent",
  activatePart: "activatePart", complete: "complete", documentMistake: "documentMistake", recordQuestion: "recordQuestion", recordAnswer: "recordAnswer", updateTopic: "updateTopic", createTopic: "createTopic",
  createTest: "createTest", addTestQuestion: "addQuestion", recordTestAnswer: "recordAnswer", documentTestMistake: "documentMistake", updateTest: "updateTest",
  createGeneric: "createGeneric", addGenericReference: "addReference", updateGeneric: "updateScratchpad",
} as const
const descriptions = {
  editTopicContent: "Atomically add, edit or delete topic content blocks by stable ID. Markdown, source and terminology blocks live in scratchpad.state.json. The app generates the document, directory and anchors. Read the current blocks before editing; all changes succeed together or none do.",
  editTestContent: "Atomically add, edit or delete test content blocks by stable ID. The app generates Markdown from the committed JSON. Questions and answers use the learning tools separately.",
  activatePart: "Mark a visited topic part active for the current thread.",
  complete: "Complete a topic part only when ALL goals have been satisfied. Active and completed can transition back and forth.",
  documentMistake: "Record a confirmed incorrect answer and its rationale on a topic part.",
  recordQuestion: "Record the exact question and activate its topic part atomically for the current thread, preserving earlier answers. No separate activation call is needed. Plan confirmation and the learner's proceed-or-practice choice still apply.",
  recordAnswer: "Record the learner's actual answer at the current thread's stepIndex. Read the recorded questions first; the question must already exist. Preserve previous attempts.",
  updateTopic: "Update topic name, curriculum, goals or references, preserving recorded mistakes and content block section IDs. Use topic_editContent for explanations and terminology. The app renders Markdown and navigation.",
  createTopic: "Create a topic only when explicitly requested or when a prerequisite topic is necessary. Returns its scratchpad handle.",
  createTest: "Create a test only when explicitly requested. Questions may be empty; source further questions one at a time with test_addQuestion.",
  addTestQuestion: "Source the next question, one at a time. Append it to the test state and scratchpad.md. Each title must be unique.",
  recordTestAnswer: "Record the user's answer to the question with this title only if it has no answer. Updates scratchpad.md; a later attempt is a new question.",
  documentTestMistake: "Record an incorrectly answered question's mistake on the matching test content part. Does not change question writers.",
  updateTest: "Update test objectives, references and content after validation with the learner. Preserve question history and existing mistakes.",
  createGeneric: "Create a generic scratchpad only when explicitly requested. Stores name and references, with free markdown content.",
  addGenericReference: "Append a source added after the generic scratchpad exists.",
  updateGeneric: "Edit a generic scratchpad's free markdown or name.",
} as const

export const scratchpadToolDefinitions = [
  ...ScratchpadMutationSchema.options.map((schema) => {
    const operation = schema.shape.type.value
    const role = mutationRoles[operation]
    let target = "scratchpadId"
    if (role === "test") target = "testId"
    if (role === "generic") target = "genericId"
    const { type: _type, scratchpadId: _id, ...shape } = schema.shape
    const parameters = z.toJSONSchema(z.object(shape), {
      override({ jsonSchema }) {
        const properties = jsonSchema.properties
        if (properties?.type && typeof properties.type === "object" && properties.type.const === "topic" && properties.id)
          properties.id = z.toJSONSchema(TopicHandleSchema)
      },
    })
    const creation = operation === "createTopic" || operation === "createTest" || operation === "createGeneric"
    if (!creation) {
      parameters.properties = { ...parameters.properties, [target]: z.toJSONSchema(TopicHandleSchema) }
      parameters.required = [...(parameters.required ?? []), target]
    }
    delete parameters.properties?.createdAt
    delete parameters.properties?.expectedSummary
    delete parameters.properties?.expectedContent
    delete parameters.properties?.expectedState
    delete parameters.properties?.expectedRevision
    return { name: `${role}_${mutationNames[operation]}`, role, operation, target, writer: true, creation, description: descriptions[operation], parameters }
  }),
  ...(["topic", "test"] as const).flatMap((role) => {
    let target = "scratchpadId"
    if (role === "test") target = "testId"
    const targetParameters = z.toJSONSchema(z.object({ [target]: TopicHandleSchema, threadId: z.string().optional() }))
    const questionsParameters = targetParameters
    if (role === "topic") {
      questionsParameters.properties = { ...questionsParameters.properties, scratchpadPartId: z.toJSONSchema(TopicPartIdSchema) }
      questionsParameters.required = [...(questionsParameters.required ?? []), "scratchpadPartId"]
    }
    return [
      { name: `${role}_getMistakesForTopic`, role, operation: "getMistakesForTopic", target, writer: false, creation: false, description: "Read mistakes from topic scratchpads only when creating evaluation questions or explicitly asked. null selects all topic scratchpads.", parameters: z.toJSONSchema(z.object({ scratchpads: z.array(TopicHandleSchema).nullable() })) },
      { name: `${role}_whereAmI`, role, operation: "whereAmI", target, writer: false, creation: false, description: "Read the current thread's position. For tests, prefer its unanswered question, then the first unanswered question.", parameters: z.toJSONSchema(z.object({ [target]: TopicHandleSchema, threadId: z.string().optional() })) },
      { name: `${role}_getQuestions`, role, operation: "getQuestions", target, writer: false, creation: false, description: "Read questions only when explicitly asked or deduplicating the next question.", parameters: questionsParameters },
    ]
  }),
  { name: "topic_whatIsNext", role: "topic", operation: "whatIsNext", target: "scratchpadId", writer: false, creation: false, description: "Read active continuations across threads and the very next untouched part. Only on a fresh thread, explicit request, or completion of a part/step.", parameters: z.toJSONSchema(z.object({ scratchpadId: TopicHandleSchema })) },
  { name: "topic_getTopicProgress", role: "topic", operation: "getTopicProgress", target: "scratchpadId", writer: false, creation: false, description: "Read curriculum-ordered progress across tutor threads.", parameters: z.toJSONSchema(z.object({ scratchpadId: TopicHandleSchema })) },
  { name: "test_getMistakes", role: "test", operation: "getTestMistakes", target: "testId", writer: false, creation: false, description: "Read mistakes on this test's content parts only for evaluation questions or when explicitly asked.", parameters: z.toJSONSchema(z.object({ testId: TopicHandleSchema })) },
  { name: "generic_getReferences", role: "generic", operation: "getGenericReferences", target: "genericId", writer: false, creation: false, description: "Read this generic scratchpad's references only when citing a source or explicitly asked.", parameters: z.toJSONSchema(z.object({ genericId: TopicHandleSchema })) },
]
export const scratchpadTools: ChatCompletionTool[] = scratchpadToolDefinitions.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }))

export function isScratchpadReadTool(name: string) {
  if (["read_skill", "read_material", "read_scratchpad", "read_topic_evidence", "test_getCoveredTopics", "list_scratchpads"].includes(name)) return true
  return scratchpadToolDefinitions.some((tool) => tool.name === name && !tool.writer)
}
