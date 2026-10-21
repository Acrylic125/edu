import { parseScratchpadCommand } from "../shared/scratchpad-commands"
import { visualizationInstructions } from "../shared/visualization"
import { messageText } from "../shared/message-text"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import OpenAI from "openai"
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions"
import { z } from "zod"
import { unified } from "unified"
import remarkParse from "remark-parse"
import {
  LearningStateSchema,
  type WorkerJob,
  type LearningState,
  type Diagnostic,
  WorkspaceSchema,
} from "../shared/contracts"
import { TopicStateSchema, TopicPartIdSchema, freshTopicState } from "../shared/topic-state"
import { existingScratchpadForCreation, StateService } from "../main/state-service"
import { runTutorGraph } from "./tutor-graph"
import { ScratchpadMutationSchema, TestStateSchema } from "../shared/scratchpad-state"
import { scratchpadToolDefinitions, scratchpadTools } from "./scratchpad-tools"
import type { TurnTelemetry } from "./telemetry"
import { readSourceImages } from "../main/source-images"
import { materialSections } from "./material-sections"
import { importStructuredContent } from "../main/structured-content-migration"
import { renderContentBlock, scratchpadMarkdown } from "../shared/scratchpad-markdown"
import { createTopicHandles, mapTopicReferenceIds, TopicHandleSchema } from "./topic-handles"

// Persisted chats may have an empty handoff; tool submissions must be ready to publish.
const SaveLearningStateSchema = LearningStateSchema.safeExtend({
  workpad: LearningStateSchema.shape.workpad.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Private handoff for the next turn. If no question is pending, record the current status explicitly."),
  nextAction: LearningStateSchema.shape.nextAction.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Concrete next action, including waiting for the learner when appropriate."),
})
const SaveLearningStateInputSchema = z.object({
  ...SaveLearningStateSchema.shape,
  pendingQuestion: z.string().max(20_000).default(""),
  question: z.string().max(20_000).optional().describe("Question for a standalone conversation without an active topic. Topic checks come from the recorded step. For a standalone choice, supply its prompt here and its options in responseOptions."),
  responseOptions: LearningStateSchema.shape.responseQuestion.unwrap().shape.options.optional(),
  pendingCheck: LearningStateSchema.shape.pendingCheck.unwrap().extend({
    topicId: TopicHandleSchema,
  }).optional().describe("Reference an unanswered recorded topic question. May be omitted when exactly one unanswered question exists."),
})

export const skillFiles = [
  "skills/MANAGE_TOPIC.md", "skills/MANAGE_TEST.md", "skills/MANAGE_GENERIC.md",
  "skills/FEEDBACK_AND_DELIBERATE.md", "skills/WHAT_IS_UNDERSTANDING.md",
  "skills/WRITING_STYLE.md", "skills/UNSLOP.md",
  ...(["topic", "test", "generic"] as const).flatMap((role) => [
    `scratchpad_templates/${role}/schema.md`, `scratchpad_templates/${role}/tools.md`,
    `scratchpad_templates/${role}/scratchpad_${role}.md`,
  ]),
] as const

const ReadMaterialSchema = z.object({
  id: z.string().uuid(),
  firstPage: z.number().int().min(1),
  lastPage: z.number().int().min(1),
  includeVisuals: z.boolean().default(false),
})
const replyParser = unified().use(remarkParse)
const ReadTopicNotesSchema = z.object({
  topicId: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20_000).default(20_000),
})
const TopicReadSchema = z.object({ topicId: z.uuid(), threadId: z.string().optional() })
const QuestionsSchema = z.object({ topicId: z.uuid(), topicPartId: TopicPartIdSchema })
const MistakesSchema = z.object({ topics: z.array(z.uuid()).nullable() })
class WritePrerequisiteError extends Error {
  constructor(message: string, readonly prerequisite: "creation" | "confirmation", readonly topicId?: string) {
    super(message)
  }
}
const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "Read a bundled Tutor Me reference or template.",
      parameters: z.toJSONSchema(z.object({ path: z.enum(skillFiles) })),
    },
  },
  {
    type: "function",
    function: {
      name: "read_material",
      description:
        "Read an accessible chat or scratchpad source. Pages are 1-based. Set includeVisuals=true to inspect a PDF slide or diagram. Limit: 15 text pages or 3 visual pages. When quoting or examining the source image itself, display it using ![description](prune-source://id/page). Create original illustrations to explain concepts.",
      parameters: z.toJSONSchema(ReadMaterialSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "read_scratchpad",
      description:
        "Read a scratchpad, its type, role skill, state and markdown, including archived scratchpads. Excludes private chat handoffs. offset and limit count characters; follow nextOffset until null for a complete review.",
      parameters: z.toJSONSchema(ReadTopicNotesSchema.omit({ topicId: true }).extend({ scratchpadId: TopicHandleSchema })),
    },
  },
  {
    type: "function",
    function: {
      name: "test_getCoveredTopics",
      description: "Read taught topic parts across all tutor threads, including older workspace topics. null selects all topics; an explicit list narrows the scope. Partial parts include only their recorded teaching evidence, not their whole planned syllabus.",
      parameters: z.toJSONSchema(z.object({ topics: z.array(TopicHandleSchema).nullable() })),
    },
  },
  ...scratchpadTools,
  {
    type: "function",
    function: {
      name: "save_learning_state",
      description:
        "Stage this chat's private handoff before every final reply. Include pending cross-topic questions. Keep checked keys only in privateAnswerKey/workpad.",
      parameters: z.toJSONSchema(SaveLearningStateInputSchema.omit({ pendingQuestion: true, responseQuestion: true })),
    },
  },
]

export async function createTutorSession(
  job: WorkerJob,
  activity: (message: string) => void,
  telemetry?: TurnTelemetry,
) {
  const request = job.chat.messages.findLast((message) => message.role === "user")
  const command = parseScratchpadCommand(request?.content ?? "")
  const scratchpadRequested = job.chat.scratchpadRequested || command !== undefined
  const topicHandles = createTopicHandles(job)
  const guides = await Promise.all(skillFiles.filter((file) => file.startsWith("skills/")).map(async (file) =>
    `${file}\n${await readFile(join(job.skillDirectory, file), "utf8")}`))
  const describe = (materials: WorkerJob["chat"]["materials"]) =>
    materials.map((material) => ({
      id: material.id,
      name: material.name,
      kind: material.kind,
      pageCount: material.pages.length || 1,
      sourceUrl: `edu-material://${material.id}/1`,
      numberedSections: materialSections(material),
    }))
  const instructions = `Tutor the learner using the supplied scratchpad management skills.

${guides.join("\n\n")}

## Showing references in chat

- Cite selectively when discussing a specific source claim, example, quotation, or figure. Place the citation and relevant source content beside that explanation, before the understanding check. Do not add a blanket source footer, cite every page read or every active-section reference, or place source material after the check. Routine feedback and original explanations need no automatic citation. This applies to chat replies only; scratchpad references may remain links.
- Cite each attached page actually used with edu-material://id/page. The chat displays cited PDF/image pages beside the paragraph containing their citation. For text assets, include the relevant excerpt, code, or table directly in your reply. Embed a specific source image with ![descriptive caption](prune-source://id/page) when needed within the explanation. Do not show source pages containing answers to a pending assessment; quote only the relevant non-answer content instead.
- For web sources, include the relevant short excerpt, code, table, or available screenshot/image and link to its original page. Respect source quotation limits. Use provider page tools to inspect the content first; never invent a screenshot or source excerpt. If content cannot be displayed, state that limitation in the chat.
- Original diagrams can clarify the explanation, but do not replace showing the source content being referenced.

## Walking through attached materials

- When the learner asks to work through supplied slides, the slides define the lesson sequence. Read every supplied file to its end before planning, in chunks of at most 15 text pages. pageCount is the document length; the tool's chunk limit is not the end of the document.
- Build one curriculum part per substantive source section heading, including subsections, in source order. Preserve its heading, numbering, page range and learning goals. Do not combine adjacent headings into one part, even if they are related: sections 2 and 3 remain separate, not a part labelled 2–3. Do not replace a deck's multiple sections with one broad part or merge methods into a thematic syllabus. Cover all substantive content; omit only covers, contents pages, and administration.
- numberedSections is inferred navigation metadata. Verify it against the source; it may miss or misclassify headings. Pages with the same section number belong together. Topic part IDs use only letters, digits and hyphens after tp- (for example tp-section-10-2); dots or underscores are invalid. If a plan write fails, correct its invalid fields without dropping any of its sections.
- numberedSections is a navigation aid, not an exhaustive content list. Include unnumbered worked-example, code, question and continuation pages within their surrounding source section. Do not trim a section's page range to only the pages that have numbered headings.
- After confirmation, start at the first source section. Explain that section's actual content, then ask its check. Walk through subsequent sections and their worked examples in order. Introduce later worked examples when their source section is reached.
- Teach the source's examples, values and code where introduced, using original illustrations to make them clear. Teach the concepts before asking the learner to use them. Keep the current explanation and check within the current section; do not ask for a method from a later section.
- Make each teaching reply self-contained: explain the concept directly with the code, table, formula or illustration needed before asking the check. Choose citations for the specific source content discussed in the reply; reading a page or having it in the active section does not require citing it. Keep scratchpad citations selective; original illustrations need no separate citation. Distinguish invented inputs from source data. The learner must be able to answer using the chat without opening slides or scratchpad notes.
- When quoting or examining a specific slide or source figure, call read_material with includeVisuals=true and embed the returned image as ![descriptive caption](prune-source://id/page), with attribution. For explaining concepts, create a suitable diagram, table or plot instead of defaulting to screenshots. If a source image being examined is unavailable, reproduce its necessary text or data and explain the limitation.
- During planning, keep the scratchpad directory and plan without prewriting the lesson. From the first teaching turn, grow one overarching example through the taught sections using MANAGE_TOPIC.md and the topic template; keep answers to pending checks private.
- During teaching, call topic_editContent with add/edit/delete changes to stable content blocks. Set present to the IDs to show in this reply; the app renders those stored blocks in chat. Use topic_updateTopic only for curriculum or metadata changes. Preserve the full curriculum.
- Save the exact source section and page in currentSection and the next source section/page in nextAction. Existing broad parts still contain ordered source sections: use the saved handoff and recorded questions to continue within them. A prewritten summary is not evidence that the learner has covered its content.

## Scratchpad roles and tools

- Only /new-topic, /new-test, and /new-generic at character zero of a learner message followed by whitespace or end of input are commands. Treat the remaining text as the learner instruction and apply the matching MANAGE skill to create that scratchpad type. A command elsewhere is ordinary text. A leading command overrides inferred type and the open scratchpad; tagged scratchpads supply context for the new scratchpad. Commands are optional.
- Infer the scratchpad type from the learner's request and chat context. Use Topic for guided learning through curriculum parts, Test for assessment/practice questions, and Generic for free notes or other work. Do not ask the learner to select a scratchpad type.
- When scratchpad creation is requested, read the request and attached sources, choose the matching role, then call topic_createTopic, test_createTest, or generic_createGeneric. Do not assume Topic. If the learner's goal is unclear, ask a focused clarification before creating anything.
- Attached materials are the primary curriculum. Inspect every attached file with read_material before creating a topic, then read the pages needed to plan its curriculum. Follow their section order, terminology, worked examples and questions when teaching. Use exact assets/<filename> references with the pages actually read. All chat attachments are preserved in the new topic's assets, including files reserved for later practice. Websites can supplement attached sources, but cannot replace them. Use a web walkthrough only when no attached materials are available. If a source cannot be read, explain the gap and ask how to proceed instead of inventing its contents.
- On each teaching turn, read the current part's cited attachment pages before explaining or asking checks. Keep scratchpad summaries and directory links grounded in those same attachments; distinguish supplementary explanations from source examples.
- Preserve the source hierarchy in topic.content: subsections such as 5.1 belong to section 5, and 5.1.1 belongs to 5.1. Set each subpart's parent to its immediate parent part; numbering in the name alone does not create a relationship.
- Reuse a scratchpad already bound to the current learner request. Creation retries return its existing handle. A similarly named scratchpad elsewhere in the workspace is read-only context, not a write target for a new scratchpad request.
- A new Topic starts as a draft. Present its source-linked plan and save phase awaiting_plan_confirmation. Do not activate parts or record questions until the learner confirms it.
- Every scratchpad has a type in scratchpad.state.json: topic, test, or generic. Apply its matching MANAGE skill and template.
- Before creating or renaming any topic, test or generic scratchpad, apply the scratchpad naming guidance in skills/UNSLOP.md to its name.
- You can read and work with several scratchpads of different types in the same turn. Assume each target's role independently; reading another scratchpad never changes the roles of previous targets.
- Skill tool names map to role-prefixed tools: topic_getQuestions, test_getQuestions, generic_getReferences. Only use a role's tools for that type. test_getMistakesForTopic reads topic evidence for the test role.
- read_scratchpad returns the target's type, role skill, structured state, and scratchpad.md. read_skill loads exact supplied skills and templates. The generic schema example's discriminator is a typo; generic state uses type=generic.
- Read access includes archived workspace scratchpads. Write access is limited to tagged/open scratchpads and those created this turn.
- IDs are stable scratchpad_N handles scoped to this chat. Use these handles in every target parameter and topic-reference id. Internal UUIDs are not accepted as target handles.
- Current thread: ${job.chat.id}. Thread identity and writer attribution are enforced by the app.
- threadTutors is shared coordination state: inspect other threads' per-part status and recorded questions/answers through the initial topicProgress/whatIsNext snapshot and state reads. Preserve their work when writing; the backend registers only writing threads. Test question threadWriters serves the same coordination purpose and is visible in test state reads.
- Preserve each part's goals, including understoodWhen criteria, and recorded mistakes with context and issue. Test and question goals and mistakes remain part of their saved state. Evaluate answers against understoodWhen and use recorded mistakes to guide follow-ups. Content edits preserve this evidence.
- Topic plans require learner confirmation before teaching. Propose and edit a source-linked curriculum first. All topic goals must be satisfied before topic_complete.
- When awaiting plan approval, save phase awaiting_plan_confirmation and omit responseOptions. The app provides the confirmation button; the learner can request changes in chat.
- The app generates the directory, section anchors and terminology table from JSON. Supply sectionId on lesson blocks, source blocks by materialId/page, and term blocks for terminology.
- Maintain explanations with topic_editContent. Read existing block IDs before editing. Supply only changed blocks, and use present to select the stored blocks for the current lesson. Learning tools record questions, answers and progress separately. Keep assessment keys in the private handoff. Continue the source order and preserve earlier working.
- Progress tools update structured evidence; save_learning_state updates only the private chat handoff.
- Record each check and follow-up once with topic_recordQuestion. In save_learning_state, select it by pendingCheck (topicId, topicPartId, stepIndex); omit the reference only when exactly one unanswered check exists. The app derives the private handoff and displayed question from that recorded step. Do not repeat the question in your final reply or supply a second copy of its text. For a standalone conversation without an active topic, supply question once in save_learning_state.
- When present selects stored blocks, the app uses them as the explanation. Otherwise write feedback in the final reply. The app renders the recorded question. Do not generate Check callouts. Include needed citations and source content within the explanation blocks selected by present, or within your final reply when no blocks are selected. Use exact material IDs and pages read with read_material.
- Tool errors and recovery prompts are internal. Repair them, then answer the original learner request with feedback, an explanation, or the pending question. Do not substitute a report about tool calls or retries for the lesson.
- Test and generic scratchpads have no topic-plan gate. Test questions and answers are maintained by test tools; generic markdown is maintained by generic_updateScratchpad.
- Each scratchpad folder contains scratchpad.md, scratchpad.state.json, and assets. Tool writes stage in one transaction. Save the private chat handoff with save_learning_state before replying.
- Native shell and delegation are unavailable. Use provider web search/page tools for online sources. If unavailable, disclose it and keep sources verifiable.

Explicit scratchpad mentions or instructions take precedence over the open scratchpad.
Scratchpad creation requested: ${scratchpadRequested}.
Explicit creation command this turn: ${command ? `${command.command}; create a ${command.type} scratchpad. Learner instruction: ${JSON.stringify(command.instruction)}` : "none; infer type from the learner request and context"}.
Opened scratchpad: ${job.openedTopicId ? topicHandles.handle(job.openedTopicId) : "none"}.
Plan confirmed this turn: ${job.confirmTopicId ? topicHandles.handle(job.confirmTopicId) : "none"}.
${visualizationInstructions}
Chat materials: ${JSON.stringify(describe(job.chat.materials))}
Chat handoff: ${JSON.stringify(mapTopicReferenceIds(z.json().parse(JSON.parse(JSON.stringify(job.chat.learning))), topicHandles.referenceHandle))}
Workspace scratchpad directory: ${JSON.stringify(job.workspaceTopics.map((topic) => ({ id: topicHandles.handle(topic.id), type: topic.state?.type ?? "topic", title: topic.title, archived: topic.archived, access: job.topics.some((tagged) => tagged.id === topic.id && !tagged.archived) ? "read/write" : "read", notesCharacters: topic.notes.length })))}
Tagged scratchpads: ${JSON.stringify(mapTopicReferenceIds(z.json().parse(job.topics.map((topic) => ({ id: topicHandles.handle(topic.id), type: topic.state?.type ?? "topic", title: topic.title, planConfirmed: topic.planConfirmed, materials: describe(topic.materials), state: topic.state ?? freshTopicState(topic.title, topic.createdAt), scratchpad: topic.learning.notes }))), topicHandles.referenceHandle))}`
  const sources = [
    ...job.chat.materials.map((material) => ({
      material,
      directory: job.assetDirectory,
    })),
    ...[...job.topics, ...job.workspaceTopics].flatMap((topic) =>
      (topic.materials ?? []).map((material) => ({
        material,
        directory: topic.assetDirectory ?? job.assetDirectory,
      })),
    ),
  ]
  const readPages = new Map<string, Set<number>>()
  function requireMaterialReview(materials: WorkerJob["chat"]["materials"]) {
    for (const material of materials) {
      for (let page = 1; page <= (material.pages.length || 1); page++) {
        if (!readPages.get(material.id)?.has(page))
          throw new Error(`Read attached file ${material.name}, page ${page}, with read_material before planning. Read every supplied file to its end so later sections are not omitted.`)
      }
    }
  }
  function requireMaterialGrounding(parts: z.infer<typeof TopicStateSchema>["content"], materials: WorkerJob["chat"]["materials"], materialIds?: string[]) {
    const referencedIds = new Set<string>()
    for (const part of parts) {
      let attached = false
      for (const reference of part.references) {
        if (reference.type === "website" || reference.type === "topic") continue
        let matches = materials.filter((material) => reference.path === `assets/${material.name}` && (!materialIds || materialIds.includes(material.id)))
        if (!matches.length) matches = sources.map(({ material }) => material)
          .filter((material) => reference.path === `assets/${material.name}` && (!materialIds || materialIds.includes(material.id)))
        const material = matches[0]
        if (!material || matches.some((match) => match.id !== material.id))
          throw new Error(`Reference ${reference.path} must identify one attached material for this topic.`)
        if (materials.some((primary) => primary.id === material.id)) attached = true
        referencedIds.add(material.id)
        let ranges = [{ from: 1, to: 1 }]
        if (reference.type === "pdf" || reference.type === "ppt") ranges = reference.pages
        for (const range of ranges) {
          if (range.to > (material.pages.length || 1)) throw new Error(`Reference pages are outside ${material.name}.`)
          for (let page = range.from; page <= range.to; page++) {
            if (!readPages.get(material.id)?.has(page))
              throw new Error(`Read ${material.name}, page ${page}, with read_material before using this part. Cite only pages you have read this turn.`)
          }
        }
      }
      if (materials.length && !attached)
        throw new Error(`Part "${part.name}" must reference the attached materials. Websites may supplement them, but cannot replace them.`)
    }
    return [...referencedIds]
  }
  let staged = WorkspaceSchema.parse({ version: 2, runners: [job.runner], chats: [job.chat], topics: job.topics })
  for (const topic of job.workspaceTopics) {
    if (!staged.topics.some((item) => item.id === topic.id)) {
      staged.topics.push({ ...job.topics[0], id: topic.id, title: topic.title, archived: topic.archived, createdAt: topic.state?.createdAt ?? new Date().toISOString(), titleGenerated: false, materials: topic.materials ?? [], planConfirmed: false, state: topic.state ?? freshTopicState(topic.title, new Date().toISOString()), learning: { ...job.chat.learning, notes: topic.notes } })
    }
  }
  for (const topic of staged.topics) {
    if (!topic.state || topic.state.type === "generic") continue
    topic.state = importStructuredContent(topic.state, topic.learning.notes)
    if (topic.state.type !== "generic") topic.learning.notes = scratchpadMarkdown(topic.state, topic.materials)
  }
  const topicMutations: z.infer<typeof ScratchpadMutationSchema>[] = []
  const writable = new Set(job.topics.filter((topic) => !topic.archived).map((topic) => topic.id))
  let writes = Promise.resolve()
  const stateService = new StateService({
    get stateSnapshot() { return structuredClone(staged) },
    mutate(update) {
      const operation = writes.then(() => {
        const candidate = structuredClone(staged)
        update(candidate)
        staged = WorkspaceSchema.parse(candidate)
      })
      writes = operation.catch(() => {})
      return operation
    },
  }, job.chat.id)
  function coveredTopicEvidence(topicIds: string[] | null) {
    return staged.topics.flatMap((topic) => {
      const state = topic.state
      if (state?.type !== "topic" || (topicIds && !topicIds.includes(topic.id))) return []
      const parts = state.content.flatMap((part) => {
        const progress = state.threadTutors.flatMap((thread) => {
          const entry = thread.progress[part.id]
          if (!entry) return []
          return [entry]
        })
        const steps = progress.flatMap((entry) => entry.steps)
        const taughtContent = (state.document?.blocks ?? []).flatMap((block) => {
          if (block.type !== "markdown" || block.sectionId !== part.id) return []
          return block.content.filter((line) => line.trim().length > 0)
        })
        const completed = progress.some((entry) => entry.status === "completed")
        if (!completed && !steps.length && !taughtContent.length) return []
        let coverage = "partial"
        if (completed) coverage = "completed"
        return [{ ...part, coverage, steps, taughtContent }]
      })
      if (!parts.length) return []
      return [{ topicId: topicHandles.handle(topic.id), title: topic.title, archived: topic.archived, parts }]
    })
  }
  const initialStatus = await Promise.all(job.topics.map(async (topic) => {
    const type = topic.state?.type ?? "topic"
    if (type === "test") return { scratchpadId: topicHandles.handle(topic.id), type, whereAmI: await stateService.whereAmIForTest(topic.id) }
    if (type === "generic") return { scratchpadId: topicHandles.handle(topic.id), type }
    return {
      scratchpadId: topicHandles.handle(topic.id), type,
      whereAmI: await stateService.whereAmI(topic.id),
      topicProgress: await stateService.getTopicProgress(topic.id),
      whatIsNext: await stateService.whatIsNext(topic.id),
    }
  }))
  let saved: LearningState | undefined
  const saveErrors = new Map<string, string>()
  const writePrerequisites = new Map<string, WritePrerequisiteError>()
  const pendingPhases = ["awaiting_answer", "awaiting_clarification", "contested"]
  const questionText = (text: string) => text.replace(/\s+/g, " ").trim()
  function activeTopicParts() {
    return staged.topics.flatMap((topic) => {
      if (!writable.has(topic.id) || topic.archived || !topic.planConfirmed || topic.state?.type !== "topic") return []
      const progress = topic.state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress ?? {}
      return Object.entries(progress).filter(([, part]) => part.status === "active")
        .map(([partId, part]) => ({ topicId: topic.id, partId, ...part }))
    })
  }
  function lessonBody(fallback: string) {
    const mutation = topicMutations.findLast((mutation) =>
      (mutation.type === "editTopicContent" || mutation.type === "editTestContent") && mutation.present?.length)
    if (!mutation || (mutation.type !== "editTopicContent" && mutation.type !== "editTestContent")) return fallback
    const topic = staged.topics.find((topic) => topic.id === mutation.topicId)
    if (!topic?.state || topic.state.type === "generic") return fallback
    return (mutation.present ?? []).map((id) => {
      const block = topic.state?.type !== "generic" ? topic.state?.document?.blocks.find((block) => block.id === id) : undefined
      if (!block) throw new Error(`Presented content block not found: ${id}`)
      return renderContentBlock(block, topic.materials)
    }).join("\n\n")
  }
  function prepareReply(reply: string) {
    reply = lessonBody(reply)
    if (!saved || !pendingPhases.includes(saved.phase)) return reply
    const edits: { start: number; end: number }[] = []
    for (const node of replyParser.parse(reply).children) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) continue
      const raw = reply.slice(start, end)
      // Older provider sessions may still emit these sections. They are projections owned by the app.
      const check = node.type === "blockquote" && /^>\s*\[!CHECK\]/.test(raw)
      const labelledCheck = node.type === "paragraph" && /^\*\*Check:\*\*/i.test(raw)
      const repeatedQuestion = node.type === "paragraph" && questionText(raw) === questionText(saved.pendingQuestion)
      if (check || labelledCheck || repeatedQuestion) edits.push({ start, end })
    }
    for (const edit of edits.reverse()) reply = reply.slice(0, edit.start) + reply.slice(edit.end)
    reply = reply.trim()
    if (saved.pendingQuestion && !saved.responseQuestion)
      reply += `\n\n> [!CHECK]\n${saved.pendingQuestion.split("\n").map((line) => `> ${line}`).join("\n")}`
    return reply.trim()
  }
  function learningStateError(state: LearningState) {
    const active = activeTopicParts()
    if (pendingPhases.includes(state.phase) && active.length && !active.some((part) => {
      if (state.pendingCheck?.topicId !== part.topicId || state.pendingCheck.topicPartId !== part.partId) return false
      const step = part.steps[state.pendingCheck.stepIndex]
      return step !== undefined && step.answerFromUser === undefined
    })) {
      return "Select an unanswered recorded check with pendingCheck (topicId, topicPartId, stepIndex)."
    }
  }
  const session = {
    instructions: topicHandles.modelText(`${instructions}\nInitial scratchpad status: ${JSON.stringify(initialStatus)}\nCovered topic evidence: ${JSON.stringify(mapTopicReferenceIds(z.json().parse(coveredTopicEvidence(null)), topicHandles.referenceHandle))}`),
    tools,
    modelText: topicHandles.modelText,
    async readMessageImages(message: WorkerJob["chat"]["messages"][number]) {
      const content: ChatCompletionContentPart[] = []
      if (message.role !== "user") return content
      for (const id of message.materialIds ?? []) {
        const source = sources.find(({ material }) => material.id === id)
        if (!source) {
          // Older topic attachments can fall outside the chat's bounded source context.
          if (message.id !== job.chat.messages.at(-1)?.id) continue
          throw new Error("An attached image is not available in this chat.")
        }
        if (source.material.kind !== "image") continue
        const [png] = await readSourceImages(source.material, source.directory, 1, 1)
        content.push(
          { type: "text", text: `Attached image: ${source.material.name}. Source: prune-source://${id}/1` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" } },
        )
        readPages.set(id, new Set([1]))
      }
      return content
    },
    async execute(
      name: string,
      input: Parameters<typeof LearningStateSchema.parse>[0],
    ) {
      const sourceImages: ChatCompletionContentPart[] = []
      let result: string
      let success = true
      let saveKey: string | undefined
      const roleTool = scratchpadToolDefinitions.find((tool) => tool.name === name)
      const writer = roleTool?.writer ?? false
      if (writer) {
        saveKey = `${name}:invalid`
      } else if (name === "save_learning_state") saveKey = name
      try {
        if (writer || name === "save_learning_state") {
          const serialized = JSON.stringify(input)
          if (serialized) input = mapTopicReferenceIds(z.json().parse(JSON.parse(topicHandles.storageText(serialized))), (id) => topicHandles.resolve(id, false))
        }
        if (roleTool) {
          if (roleTool.creation && command && roleTool.role !== command.type)
            throw new WritePrerequisiteError(`${command.command} requires creating a ${command.type} scratchpad with its matching role tool.`, "creation")
          const argumentsObject = z.record(z.string(), z.json()).parse(input)
          const identity = z.object({ threadId: z.string().optional() }).parse(argumentsObject)
          if (identity.threadId !== undefined && identity.threadId !== job.chat.id) throw new Error("Only the current thread's progress can be accessed or written.")
          if (roleTool.operation === "getMistakesForTopic") {
            const { topics } = z.object({ topics: z.array(z.string()).nullable() }).parse(argumentsObject)
            input = { ...argumentsObject, topics: topics?.map((handle) => topicHandles.resolve(handle, false)) ?? null }
          } else if (!roleTool.creation) {
            let topicId
            try {
              topicId = topicHandles.resolve(argumentsObject[roleTool.target] ?? null, writer)
            } catch (error) {
              if (writer && scratchpadRequested && writable.size === 0 && error instanceof Error)
                throw new WritePrerequisiteError(error.message, "creation")
              throw error
            }
            const target = staged.topics.find((item) => item.id === topicId)
            if ((target?.state?.type ?? "topic") !== roleTool.role)
              throw new Error(`${name} requires a ${roleTool.role} scratchpad. This target is ${target?.state?.type ?? "topic"}.`)
            input = { ...argumentsObject, topicId }
            if (writer) saveKey = `${name}:${topicHandles.handle(topicId)}`
          }
        }
        if (name === "read_skill") {
          const { path } = z.object({ path: z.enum(skillFiles) }).parse(input)
          activity("Reading tutoring guidance")
          result = await readFile(join(job.skillDirectory, path), "utf8")
        } else if (name === "test_getCoveredTopics") {
          const { topics } = z.object({ topics: z.array(TopicHandleSchema).nullable() }).parse(input)
          const topicIds = topics?.map((handle) => topicHandles.resolve(handle, false)) ?? null
          result = JSON.stringify(coveredTopicEvidence(topicIds))
        } else if (name === "read_scratchpad") {
          const argumentsObject = z.object({ scratchpadId: TopicHandleSchema, offset: ReadTopicNotesSchema.shape.offset, limit: ReadTopicNotesSchema.shape.limit }).parse(input)
          const topicId = topicHandles.resolve(argumentsObject.scratchpadId, false)
          const { offset, limit } = argumentsObject
          const topic = staged.topics.find((item) => item.id === topicId)
          if (!topic) throw new Error("Topic not found in this workspace.")
          const notes = topic.learning.notes
          if (offset > notes.length) throw new Error("Offset is outside this topic's notes.")
          const end = Math.min(offset + limit, notes.length)
          let nextOffset: number | null = null
          if (end < notes.length) nextOffset = end
          activity(`Reading ${topic.title} study history`)
          result = JSON.stringify({
            scratchpadId: topicHandles.handle(topicId), type: topic.state?.type ?? "topic", roleSkill: `skills/MANAGE_${(topic.state?.type ?? "topic").toUpperCase()}.md`, state: topic.state, title: topic.title, archived: topic.archived,
            notes: notes.slice(offset, end), offset, nextOffset, totalCharacters: notes.length,
          })
        } else if (name === "read_material") {
          const { id, firstPage, lastPage, includeVisuals } =
            ReadMaterialSchema.parse(input)
          const entry = sources.find((item) => item.material.id === id)
          if (!entry) throw new Error("Material not found.")
          const { material, directory } = entry
          if (lastPage < firstPage || lastPage - firstPage >= 15)
            throw new Error("Read 1–15 pages at a time.")
          activity(`Reading ${material.name}`)
          const pages = material.pages.length ? material.pages : [material.text]
          if (firstPage > pages.length || lastPage > pages.length)
            throw new Error("Page is outside this source.")
          result = `Source: ${material.name}\nSource link: [${material.name}, pg. ${firstPage}${lastPage > firstPage ? `-${lastPage}` : ""}](edu-material://${id}/${firstPage})\n\n` + pages
            .slice(firstPage - 1, lastPage)
            .map((text, index) => `Page ${firstPage + index}\n${text}`)
            .join("\n\n")
          if (result.length > 60_000)
            throw new Error("This excerpt is too large. Read fewer pages.")
          if (
            material.kind === "image" ||
            (includeVisuals && material.kind === "pdf")
          ) {
            if (lastPage - firstPage >= 3)
              throw new Error("Read at most 3 visual pages at a time.")
            const images = await readSourceImages(material, directory, firstPage, lastPage)
            for (let page = firstPage; page <= lastPage; page++) {
              const png = images[page - firstPage]
              const url = `prune-source://${id}/${page}`
              result += `\nSource image page ${page}: ![${material.name}, page ${page}](${url}). Embed this image when quoting or examining the source figure itself. For explaining concepts, create an original illustration. Exclude answer annotations for pending assessments.`
              sourceImages.push(
                {
                  type: "text",
                  text: `${material.name}, page ${page}. Display URL: ${url}`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${png.toString("base64")}`,
                  },
                },
              )
            }
          }
          const read = readPages.get(id) ?? new Set<number>()
          for (let page = firstPage; page <= lastPage; page++) read.add(page)
          readPages.set(id, read)
        } else if (roleTool) {
          const operation = roleTool.operation
          const argumentsObject = z.record(z.string(), z.json()).parse(input)
          if (operation === "getMistakesForTopic") {
            const mistakes = await stateService.getMistakesForTopic(MistakesSchema.parse(input).topics)
            result = JSON.stringify(mistakes.map((mistake) => ({ ...mistake, topicId: topicHandles.handle(mistake.topicId) })))
          } else if (!roleTool.writer) {
            const { topicId } = TopicReadSchema.parse(input)
            if (operation === "whereAmI" && roleTool.role === "topic") result = JSON.stringify(await stateService.whereAmI(topicId))
            else if (operation === "whereAmI") result = JSON.stringify(await stateService.whereAmIForTest(topicId))
            else if (operation === "getTopicProgress") result = JSON.stringify(await stateService.getTopicProgress(topicId))
            else if (operation === "whatIsNext") result = JSON.stringify(await stateService.whatIsNext(topicId))
            else if (operation === "getQuestions" && roleTool.role === "topic") result = JSON.stringify(await stateService.getQuestions(topicId, QuestionsSchema.parse(input).topicPartId))
            else if (operation === "getQuestions") result = JSON.stringify(await stateService.getTestQuestions(topicId))
            else if (operation === "getTestMistakes") result = JSON.stringify(await stateService.getTestMistakes(topicId))
            else if (operation === "getGenericReferences") result = JSON.stringify(await stateService.getGenericReferences(topicId))
            else throw new Error("This role tool is not available.")
          } else {
            const mutation = ScratchpadMutationSchema.parse({ ...argumentsObject, type: operation, ...(roleTool.creation ? { topicId: randomUUID() } : {}) })
            const target = staged.topics.find((topic) => topic.id === mutation.topicId)
            let draftContent
            if (mutation.type === "createTopic") draftContent = mutation.topic.content
            if (mutation.type === "updateTopic" && !target?.planConfirmed) draftContent = mutation.content
            if (draftContent?.some((part) => !part.references.length))
              throw new Error("Every draft curriculum part needs source references from an existing walkthrough. Research sources before proposing a plan.")
            const materials = [...new Map([...job.chat.materials, ...(target?.materials ?? [])].map((material) => [material.id, material])).values()]
            if (mutation.type === "createTopic") {
              if (materials.length && !mutation.topic.content.length)
                throw new Error("Read the attached materials and propose a source-linked curriculum before creating the topic.")
              const referencedIds = requireMaterialGrounding(mutation.topic.content, materials, mutation.materialIds)
              const planningMaterials = [...new Map([
                ...materials,
                ...sources.map(({ material }) => material).filter((material) => referencedIds.includes(material.id)),
              ].map((material) => [material.id, material])).values()]
              requireMaterialReview(planningMaterials)
              mutation.materialIds = [...new Set([
                ...referencedIds,
                ...planningMaterials.map((material) => material.id),
              ])]
            }
            if (mutation.type === "updateTopic" && mutation.content) {
              const referencedIds = requireMaterialGrounding(mutation.content, materials, mutation.materialIds)
              const planningMaterials = [...new Map([
                ...materials,
                ...sources.map(({ material }) => material).filter((material) => referencedIds.includes(material.id)),
              ].map((material) => [material.id, material])).values()]
              requireMaterialReview(planningMaterials.filter((material) => !materials.some((existing) => existing.id === material.id)))
              mutation.materialIds = referencedIds
            }
            if (roleTool.role === "topic" && target?.planConfirmed) {
              const state = TopicStateSchema.parse(target.state)
              // Existing references belong to the topic even when a chat attaches another file with the same name.
              const teachingMaterials = [...target.materials, ...job.chat.materials.filter((material) => !target.materials.some((attached) => attached.name === material.name))]
              if ("topicPartId" in mutation)
                requireMaterialGrounding(state.content.filter((part) => part.id === mutation.topicPartId), teachingMaterials)
              if (mutation.type === "editTopicContent") {
                const progress = state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress
                const sectionIds = new Set(mutation.changes.flatMap((change) => {
                  if (change.action === "delete") return []
                  return "sectionId" in change.block && change.block.sectionId ? [change.block.sectionId] : []
                }))
                requireMaterialGrounding(state.content.filter((part) => sectionIds.has(part.id) || progress?.[part.id]?.status === "active"), teachingMaterials)
              }
            }
            if (mutation.type === "editTopicContent" || mutation.type === "editTestContent") {
              for (const change of mutation.changes) {
                if (change.action === "delete" || change.block.type !== "source") continue
                if (!readPages.get(change.block.materialId)?.has(change.block.page))
                  throw new Error(`Read content source ${change.block.materialId}, page ${change.block.page}, before citing it.`)
              }
            }
            if (!roleTool.creation) {
              if (!writable.has(mutation.topicId)) throw new Error("Only tagged or newly created scratchpads can be written.")
              if (roleTool.role === "topic" && !target?.planConfirmed && mutation.type !== "updateTopic")
                throw new WritePrerequisiteError("Wait for the learner to confirm the proposed plan. Present the plan and save phase awaiting_plan_confirmation; do not retry teaching before approval.", "confirmation", mutation.topicId)
              if (mutation.type === "updateTopic" && target) {
                if (mutation.content !== undefined) mutation.expectedContent = TopicStateSchema.parse(target.state).content
              }
              if ((mutation.type === "editTopicContent" || mutation.type === "editTestContent") && target?.state && target.state.type !== "generic") mutation.expectedRevision = target.state.revision
              if (mutation.type === "updateGeneric" && target) mutation.expectedSummary = target.learning.notes
              if (mutation.type === "updateTest" && target) mutation.expectedState = TestStateSchema.parse(target.state)
            }
            const existing = existingScratchpadForCreation(staged, job.chat.id, mutation)
            if (existing) {
              result = JSON.stringify({ scratchpadId: topicHandles.handle(existing.id), type: existing.state?.type, staged: true, reused: true, nextAction: "Use the matching update tool to revise this scratchpad." })
            } else {
              await stateService.write(mutation)
              if ("materialIds" in mutation) mutation.materialIds = staged.topics.find((topic) => topic.id === mutation.topicId)?.materials.map((material) => material.id)
              topicMutations.push(mutation)
              if (roleTool.creation) {
                writable.add(mutation.topicId)
                topicHandles.register(mutation.topicId)
              }
              activity("Staging scratchpad state")
              let nextAction = "Maintain this scratchpad with its matching role tools."
              if (mutation.type === "createTopic") nextAction = "Present the proposed plan and save phase awaiting_plan_confirmation. Wait for learner approval before activating parts or recording questions."
              result = JSON.stringify({ scratchpadId: topicHandles.handle(mutation.topicId), type: roleTool.role, staged: true, nextAction, ...((mutation.type === "editTopicContent" || mutation.type === "editTestContent") && { state: staged.topics.find((topic) => topic.id === mutation.topicId)?.state }) })
            }
          }
        } else if (name === "save_learning_state") {
          saved = undefined
          const handoff = SaveLearningStateInputSchema.parse(input)
          const active = activeTopicParts()
          const unanswered = active.flatMap((part) => part.steps.flatMap((step, stepIndex) => {
            if (step.answerFromUser !== undefined) return []
            return [{ topicId: part.topicId, topicPartId: part.partId, stepIndex, question: step.question }]
          }))
          let pendingQuestion = handoff.question ?? handoff.pendingQuestion
          let pendingCheck: LearningState["pendingCheck"]
          if (pendingPhases.includes(handoff.phase) && active.length) {
            let selected
            if (handoff.pendingCheck) {
              const topicId = topicHandles.resolve(handoff.pendingCheck.topicId, false)
              selected = unanswered.find((step) => step.topicId === topicId && step.topicPartId === handoff.pendingCheck?.topicPartId && step.stepIndex === handoff.pendingCheck.stepIndex)
            } else if (unanswered.length === 1) selected = unanswered[0]
            if (!selected) throw new Error("Select an unanswered recorded check with pendingCheck (topicId, topicPartId, stepIndex). Use topic_recordQuestion first if none exists.")
            pendingCheck = { topicId: selected.topicId, topicPartId: selected.topicPartId, stepIndex: selected.stepIndex }
            pendingQuestion = selected.question
          }
          if (!pendingPhases.includes(handoff.phase)) pendingQuestion = ""
          const candidate = SaveLearningStateSchema.parse({ ...handoff, pendingQuestion, pendingCheck })
          if (handoff.responseOptions)
            candidate.responseQuestion = LearningStateSchema.shape.responseQuestion.unwrap().parse({ prompt: pendingQuestion || handoff.question || "", options: handoff.responseOptions })
          if (candidate.responseQuestion && pendingPhases.includes(candidate.phase))
            candidate.responseQuestion.prompt = pendingQuestion
          const created = topicMutations.some((mutation) => ["createTopic", "createTest", "createGeneric"].includes(mutation.type))
          if (scratchpadRequested && !created && !["awaiting_choice", "awaiting_clarification"].includes(candidate.phase))
            throw new Error("Infer the scratchpad type from this chat and create it with the matching role tool before saving, or ask a focused clarification if the learner's goal is unclear.")
          const draftIds = new Set(staged.topics.filter((topic) => writable.has(topic.id) && !topic.archived && !topic.planConfirmed && topic.state?.type === "topic" && topic.state.content.length > 0).map((topic) => topic.id))
          if (candidate.phase === "awaiting_plan_confirmation" && draftIds.size) {
            delete candidate.responseQuestion
          }
          const error = learningStateError(candidate)
          if (error) throw new Error(error)
          for (const [key, issue] of writePrerequisites) {
            let resolved = false
            if (issue.prerequisite === "creation" && created) {
              const createdTopic = topicMutations.some((mutation) => mutation.type === "createTopic")
              resolved = !createdTopic || (candidate.phase === "awaiting_plan_confirmation" && draftIds.size > 0)
            }
            if (issue.prerequisite === "confirmation" && candidate.phase === "awaiting_plan_confirmation" && issue.topicId && draftIds.has(issue.topicId)) resolved = true
            if (resolved) {
              saveErrors.delete(key)
              writePrerequisites.delete(key)
            }
          }
          saved = candidate
          activity("Saving the chat handoff")
          result =
            "Chat handoff staged. Provide only the explanation or feedback. Place needed references beside the relevant explanation. The app renders the recorded question from authoritative state. Everything commits together before display."
        } else {
          throw new Error("This tool is not available.")
        }
        if (saveKey) {
          saveErrors.delete(saveKey)
          writePrerequisites.delete(saveKey)
          if (writer) {
            saveErrors.delete(`${name}:invalid`)
            writePrerequisites.delete(`${name}:invalid`)
          }

        }
      } catch (error) {
        telemetry?.reject()
        success = false
        result = `Tool error: ${error instanceof Error ? error.message : "Invalid tool arguments."}`
        if (saveKey) {
          saveErrors.set(saveKey, result)
          writePrerequisites.delete(saveKey)
          if (error instanceof WritePrerequisiteError) writePrerequisites.set(saveKey, error)
        }
      }
      if (success && (roleTool || name === "read_scratchpad" || name === "test_getCoveredTopics")) {
        const parsed = z.json().safeParse(JSON.parse(result))
        if (parsed.success) result = JSON.stringify(mapTopicReferenceIds(parsed.data, topicHandles.referenceHandle))
      }
      return { text: topicHandles.modelText(result), images: sourceImages, success }
    },
    get saved() {
      return saved !== undefined && saveErrors.size === 0 && !learningStateError(saved)
    },
    get saveError() {
      if (saveErrors.size) {
        return topicHandles.modelText([...saveErrors.entries()].map(([key, error]) => `Correct ${key}; save_learning_state cannot repair a rejected scratchpad write. ${error}`).join("\n"))
      }
      if (saved) return learningStateError(saved)
    },
    hasReply(reply: string) {
      return lessonBody(reply).trim().length > 0
    },
    recoveryMessage(reply: string) {
      const request = job.chat.messages.findLast((message) => message.role === "user")
      const error = session.saveError
      return `Internal app correction, not a learner message.\nOriginal learner request: ${JSON.stringify(topicHandles.modelText(request?.content ?? ""))}\n${error ?? "A complete saved handoff and a learner-facing reply are required."}\nRepair outstanding writes with their original tool and target and maintain the scratchpad. Save the private handoff with save_learning_state. Reply to the original learner with only the subject explanation or feedback. The app renders the recorded question; do not repeat it. Place any needed references beside the relevant explanation. Keep internal tool errors, write operations, and retries out of the lesson.`
    },
    previewReply(reply: string) {
      if (!saved || saveErrors.size || learningStateError(saved)) return ""
      return topicHandles.storageText(prepareReply(reply))
    },
    finish(reply: string) {
      reply = topicHandles.storageText(prepareReply(reply))
      if (!saved || saveErrors.size || learningStateError(saved))
        throw new Error(
          [...saveErrors.values()].join("\n") ||
            (saved && learningStateError(saved)) ||
            "The runner did not save a complete learning state. Retry this turn.",
        )
      if (!reply.trim())
        throw new Error("The runner returned no lesson. Retry this turn.")
      return {
        reply,
        learning: saved,
        topicUpdates: [],
        topicMutations,
      }
    },
  }
  if (telemetry) {
    const execute = session.execute
    session.execute = (name, input) => telemetry.span(name, "TOOL",
      () => execute(name, input), { "tool.name": name })
  }
  return session
}

export async function runTutorTurn(
  job: WorkerJob,
  client: Pick<OpenAI, "chat">,
  activity: (message: string) => void,
  diagnostic: Diagnostic = () => {},
  telemetry?: TurnTelemetry,
  onReply: (text: string) => void = () => {},
) {
  const session = await createTutorSession(job, activity, telemetry)
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: session.instructions },
    ...await Promise.all(job.chat.messages.map(async (message) => {
      if (message.role === "assistant") return { role: "assistant" as const, content: session.modelText(messageText(message)) }
      const images = await session.readMessageImages(message)
      if (!images.length) return { role: "user" as const, content: session.modelText(messageText(message)) }
      return { role: "user" as const, content: [{ type: "text" as const, text: session.modelText(messageText(message)) }, ...images] }
    })),
  ]
  let response: OpenAI.Chat.Completions.ChatCompletionMessage | undefined
  return runTutorGraph({
    session,
    maxAttempts: 16,
    diagnostic,
    telemetry,
    async model(iteration) {
      activity("Preparing your lesson")
      diagnostic("model.request", {
        iteration,
        model: job.runner.model,
      })
      onReply("")
      const parameters = {
        model: job.runner.model,
        messages,
        tools: session.tools,
        max_completion_tokens: 12_000,
        stream: true as const,
      }
      const stream = client.chat.completions.stream(parameters)
      stream.on("content", (_delta, text) => onReply(session.previewReply(text)))
      const completion = await stream.finalChatCompletion()
      response = completion.choices[0]?.message
      if (!response)
        throw new Error(
          "The model returned no response. Try another runner or retry.",
        )
      if (completion.choices[0].finish_reason === "length")
        throw new Error(
          "The lesson exceeded the model response limit. Ask for a smaller section and retry.",
        )
      messages.push(response)
      diagnostic("model.response", {
        iteration,
        finishReason: completion.choices[0].finish_reason,
        toolCalls: response.tool_calls?.length ?? 0,
        replyCharacters: response.content?.length ?? 0,
        saved: session.saved,
      })
      return {
        reply: response.content ?? "",
        calls: (response.tool_calls ?? []).flatMap((call) => {
          if (call.type !== "function") throw new Error("The model requested an unsupported tool.")
          return [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
        }),
        finishAfterTools: false,
      }
    },
    recover(message) {
      messages.push({
        role: "user",
        content: message,
      })
    },
    consumeTools(calls, results) {
      const sourceImages: ChatCompletionContentPart[] = []
      for (const [index, call] of calls.entries()) {
        messages.push({ role: "tool", tool_call_id: call.id ?? "", content: results[index].text })
        sourceImages.push(...results[index].images)
      }
      if (sourceImages.length) messages.push({ role: "user", content: sourceImages })
    },
    exhausted: () => new Error(
      "The runner reached its tool limit. Retry with a narrower request.",
    ),
  })
}
