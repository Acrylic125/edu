import { parseScratchpadCommand } from "../shared/scratchpad-commands"
import { visualizationInstructions } from "../shared/visualization"
import { chatTeachingInstructions } from "./chat-teaching"
import { messageText } from "../shared/message-text"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
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
import { applyTopicChanges, TopicStateSchema, TopicPartIdSchema, freshTopicState } from "../shared/topic-state"
import { existingScratchpadForCreation, StateService } from "../main/state-service"
import { runTutorLoop } from "./tutor-loop"
import { ScratchpadMutationSchema, ScratchpadTypeSchema, TestStateSchema, scratchpadReferences } from "../shared/scratchpad-state"
import { scratchpadToolDefinitions, scratchpadTools } from "./scratchpad-tools"
import type { TurnTelemetry } from "./telemetry"
import { readCachedExtraction } from "../main/material-extraction"
import { readSourceImages } from "../main/source-images"
import { materialSections } from "./material-sections"
import { importStructuredContent } from "../main/structured-content-migration"
import { renderContentBlock, scratchpadMarkdown } from "../shared/scratchpad-markdown"
import { createTopicHandles, mapTopicReferenceIds, TopicHandleSchema } from "./topic-handles"
import { scratchpadOperationId } from "../shared/scratchpad-operation"
import type { RoleJobSchema } from "../shared/tutor-workflow"
import { scratchpadContext, selectTutorTopicIds, topicPartCoverage } from "./tutor-evidence"
import { readSkillCatalog, skillFiles } from "./tutor-skills"
import { topicCompletionEvidence } from "../shared/topic-completion"
import { rejectsRepeatedChecks, TopicCheckBlockedError } from "../shared/topic-feedback"
export { skillFiles } from "./tutor-skills"

// Persisted chats may have an empty handoff; tool submissions must be ready to publish.
const SaveLearningStateSchema = LearningStateSchema.safeExtend({
  workpad: LearningStateSchema.shape.workpad.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Private handoff for the next turn. If no question is pending, record the current status explicitly."),
  nextAction: LearningStateSchema.shape.nextAction.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Concrete next action, including waiting for the learner when appropriate."),
})
const SaveLearningStateInputSchema = z.object({
  ...SaveLearningStateSchema.shape,
  pendingQuestion: z.string().max(20_000).default(""),
  question: z.string().max(20_000).optional().describe("Question for a standalone conversation without an active topic. Topic checks come from the recorded step. To clarify the current topic check, use phase awaiting_clarification, keep pendingCheck on the same latest step, and supply the clearer prompt here. For a navigation choice, use phase awaiting_choice with its prompt here and responseOptions."),
  responseOptions: LearningStateSchema.shape.responseQuestion.unwrap().shape.options.optional(),
  pendingCheck: LearningStateSchema.shape.pendingCheck.unwrap().extend({
    scratchpadId: TopicHandleSchema,
  }).optional().describe("Reference the latest check in its topic part. awaiting_answer requires an unanswered check; awaiting_clarification may clarify the latest answered check too. May be omitted when exactly one eligible latest check exists."),
})

const ReadMaterialSchema = z.object({
  id: z.string().uuid(),
  firstPage: z.number().int().min(1),
  lastPage: z.number().int().min(1),
  includeVisuals: z.boolean().default(false),
})
const replyParser = unified().use(remarkParse)
const ReadTopicNotesSchema = z.object({
  scratchpadId: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20_000).default(20_000),
})
const TopicReadSchema = z.object({ scratchpadId: z.uuid(), threadId: z.string().optional() })
const QuestionsSchema = z.object({ scratchpadId: z.uuid(), scratchpadPartId: TopicPartIdSchema })
const MistakesSchema = z.object({ scratchpads: z.array(z.uuid()).nullable() })
const CoverageQuerySchema = z.object({
  scratchpads: z.array(TopicHandleSchema).nullable(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(25),
})
const ReadTopicEvidenceSchema = ReadTopicNotesSchema.omit({ scratchpadId: true }).extend({ scratchpadId: TopicHandleSchema, scratchpadPartId: TopicPartIdSchema })
const ScratchpadDirectorySchema = z.object({
  query: z.string().max(1000).default(""), type: ScratchpadTypeSchema.optional(),
  includeArchived: z.boolean().default(true), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(25),
})
class WritePrerequisiteError extends Error {
  constructor(message: string, readonly prerequisite: "creation" | "confirmation", readonly scratchpadId?: string) {
    super(message)
  }
}
const tools: ChatCompletionTool[] = [
  {
    type: "function", function: {
      name: "list_scratchpads", description: "Discover scratchpad handles, titles, types, archive status and role write grants. Filter by title or type and follow nextOffset for more results. Returns metadata without lesson or assessment history.",
      parameters: z.toJSONSchema(ScratchpadDirectorySchema),
    },
  },
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
        "Read an accessible chat or scratchpad source. Pages are 1-based. Set includeVisuals=true to inspect a PDF slide or diagram. Limit: 15 text pages or 3 visual pages. When quoting or examining the source image itself, display it using ![description](edu-source://id/page). Create original illustrations to explain concepts.",
      parameters: z.toJSONSchema(ReadMaterialSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "read_scratchpad",
      description:
        "Read a scratchpad, its type, role skill, state and markdown, including archived scratchpads. Excludes private chat handoffs. offset and limit count characters; follow nextOffset until null for a complete review.",
      parameters: z.toJSONSchema(ReadTopicNotesSchema.omit({ scratchpadId: true }).extend({ scratchpadId: TopicHandleSchema })),
    },
  },
  {
    type: "function",
    function: {
      name: "read_topic_evidence",
      description: "Read one topic part's goals, mistakes, recorded questions and answers across tutor threads, and section-linked content blocks. The evidence field contains paginated JSON text; offset and limit count characters. Follow nextOffset for the required history. Planned goals alone do not establish teaching coverage.",
      parameters: z.toJSONSchema(ReadTopicEvidenceSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "test_getCoveredTopics",
      description: "Discover covered topic parts through paginated summaries: planned objectives, coverage status, question/answer counts and taught block counts. null uses the current test's saved source topics, or all readable topics for a new test; an explicit list selects a requested scope. Read a selected part with read_topic_evidence before using its detailed history, especially partial coverage. Follow nextOffset to discover the full requested scope.",
      parameters: z.toJSONSchema(CoverageQuerySchema),
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
  stage?: {
    topicWorkflow?: boolean
    skillPaths?: readonly string[]
    creationId?: string
    operations?: z.infer<typeof ScratchpadMutationSchema>[]
    priorMutations?: z.infer<typeof ScratchpadMutationSchema>[]
    persist?: (mutation: z.infer<typeof ScratchpadMutationSchema>) => Promise<void>
    readEvidence?: z.infer<typeof RoleJobSchema>["readEvidence"]
    recordRead?: (id: string, firstPage: number, lastPage: number) => Promise<void>
  },
) {
  const request = job.chat.messages.findLast((message) => message.role === "user")
  const command = parseScratchpadCommand(request?.content ?? "")
  const scratchpadRequested = job.chat.scratchpadRequested || command !== undefined
  const scratchpadHandles = createTopicHandles(job)
  const focusedIds = new Set(selectTutorTopicIds(job.chat, job.openedScratchpadId, job.confirmScratchpadId))
  const focusedTopics = [...new Map([...job.workspaceScratchpads, ...job.scratchpads].map((scratchpad) => [scratchpad.id, scratchpad])).values()].filter((scratchpad) => focusedIds.has(scratchpad.id))
  const currentTests = job.scratchpads.filter((scratchpad) => scratchpad.state?.type === "test")
  let savedTestScope: string[] | null = null
  if (currentTests.length) {
    savedTestScope = [...new Set(currentTests.flatMap((scratchpad) => {
      if (scratchpad.state?.type !== "test") return []
      return scratchpadReferences(scratchpad.state).flatMap((reference) => {
        if (reference.type === "topic") return [reference.id]
        return []
      })
    }))]
  }
  const catalog = await readSkillCatalog(job.skillDirectory, stage?.skillPaths ?? skillFiles)
  const describe = (materials: WorkerJob["chat"]["materials"]) =>
    materials.map((material) => ({
      id: material.id,
      name: material.name,
      kind: material.kind,
      pageCount: material.pages.length || 1,
      sourceUrl: `edu-material://${material.id}/1`,
      numberedSections: materialSections(material),
    }))
  const focusedScratchpads = focusedTopics.map((scratchpad) => ({
    id: scratchpadHandles.handle(scratchpad.id), title: scratchpad.title,
    planConfirmed: job.scratchpads.find((target) => target.id === scratchpad.id)?.planConfirmed ?? false,
    materials: describe(scratchpad.materials ?? []), ...scratchpadContext(scratchpad, job.chat),
  }))
  const instructions = `Tutor the learner using the supplied scratchpad management skills.

Read the relevant skill with read_skill when its description matches the task. Available skills: ${JSON.stringify(catalog)}

${chatTeachingInstructions}

## Walking through attached materials

- When the learner asks to work through supplied slides, the slides define the lesson sequence within the requested scope. Identify headings and page boundaries first. Read selected sections, continuation pages, and required dependencies before planning. For a whole-document request, include every substantive section. Practice attachments remain available for later practice without reviewing every exercise during creation.
- Build one curriculum part per substantive source section heading, including subsections, in source order. Preserve its heading, numbering, page range and learning goals. Do not combine adjacent headings into one part, even if they are related: sections 2 and 3 remain separate, not a part labelled 2–3. Do not replace a deck's multiple sections with one broad part or merge methods into a thematic syllabus. Cover all substantive content; omit only covers, contents pages, and administration.
- numberedSections is inferred navigation metadata. Verify it against the source; it may miss or misclassify headings. Pages with the same section number belong together. Topic part IDs use only letters, digits and hyphens after tp- (for example tp-section-10-2); dots or underscores are invalid. If a plan write fails, correct its invalid fields without dropping any of its sections.
- numberedSections is a navigation aid, not an exhaustive content list. Include unnumbered worked-example, code, question and continuation pages within their surrounding source section. Do not trim a section's page range to only the pages that have numbered headings.
- During planning, keep the scratchpad directory and plan without prewriting the lesson. During topic teaching, use the learner-answer workflow in MANAGE_TOPIC.md and the topic template. Establish one overarching example, then develop its walkthrough from assessed learner explanations while preserving the required source content; keep answers to pending checks private.
- During teaching, call topic_editContent with add/edit/delete changes to stable content blocks. Follow MANAGE_TOPIC.md for the scratchpad format and omit present by default. Write a separate, self-contained chat explanation; use present only when the learner explicitly asks to show saved blocks in chat. Use topic_updateTopic with explicit add, update, remove or move changes for curriculum revisions. Update patches only supplied fields; omitted parts remain. Use null afterId to insert or move to the beginning. Removed parts retain historical evidence.

## Scratchpad roles and tools

- Only /new-topic, /new-test, and /new-generic at character zero of a learner message followed by whitespace or end of input are commands. Treat the remaining text as the learner instruction and apply the matching MANAGE skill to create that scratchpad type. A command elsewhere is ordinary text. A leading command overrides inferred type and the open scratchpad; tagged scratchpads supply context for the new scratchpad. Commands are optional.
- Infer the scratchpad type from the learner's request and chat context. Use Topic for guided learning through curriculum parts, Test for assessment/practice questions, and Generic for free notes or other work. Do not ask the learner to select a scratchpad type.
- When scratchpad creation is requested, read the request and attached sources, choose the matching role, then call topic_createTopic, test_createTest, or generic_createGeneric. Do not assume Topic. If the learner's goal is unclear, ask a focused clarification before creating anything.
- Attached materials are the primary curriculum. Inspect every attached file with read_material before creating a topic, then read the pages needed to plan its curriculum. Follow their section order, terminology, worked examples and questions when teaching. Use exact assets/<filename> references with the pages actually read. All chat attachments are preserved in the new topic's assets, including files reserved for later practice. Websites can supplement attached sources, but cannot replace them. Use a web walkthrough only when no attached materials are available. If a source cannot be read, explain the gap and ask how to proceed instead of inventing its contents.
- Read the specific source pages needed for the current explanation or check. Recording an answer or progress does not require rereading the curriculum's full reference range. Keep scratchpad summaries and directory links grounded in those same attachments; distinguish supplementary explanations from source examples.
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
- The focused scratchpad context supplies the current objective, compact progress and latest check. Use read_topic_evidence for a selected part's earlier questions, answers and lesson blocks; use read_scratchpad for a full scratchpad review. Cross-thread history remains available through these reads. Preserve other threads' work when writing; the backend registers only writing threads.
- Preserve each part's goals, including understoodWhen criteria, and recorded mistakes with context and issue. Test and question goals and mistakes remain part of their saved state. Evaluate answers against understoodWhen and use recorded mistakes to guide follow-ups. Content edits preserve this evidence.
- Topic plans require learner confirmation before teaching. Propose and edit a source-linked curriculum first. All topic goals must be satisfied before topic_complete.
- When awaiting plan approval, save phase awaiting_plan_confirmation and omit responseOptions. The app provides the confirmation button; the learner can request changes in chat.
- The app generates the directory, section anchors and terminology table from JSON. Supply sectionId on lesson blocks, source blocks by materialId/page, and term blocks for terminology.
- Maintain explanations with topic_editContent. Read existing block IDs before editing. Supply only changed blocks. Save the scratchpad walkthrough separately from the chat explanation; use present only for an explicit request to show stored blocks. Learning tools record questions, answers and progress separately. Keep assessment keys in the private handoff. Continue the source order and preserve earlier working.
- Progress tools update structured evidence; save_learning_state updates only the private chat handoff.
- Record each check and follow-up once with topic_recordQuestion. In save_learning_state, select it by pendingCheck (scratchpadId, scratchpadPartId, stepIndex); omit the reference only when exactly one unanswered check exists. The app derives the private handoff and displayed question from that recorded step. Do not repeat the question in your final reply or supply a second copy of its text. For a standalone conversation without an active topic, supply question once in save_learning_state.
- When present selects stored blocks, the app uses them as the explanation. Otherwise write the chat explanation or feedback in the final reply. The app renders the recorded question. Do not generate Check callouts. Include needed citations and source content within the explanation blocks selected by present, or within your final reply when no blocks are selected. Use exact material IDs and pages read with read_material.
- Tool errors and recovery prompts are internal. Repair them, then answer the original learner request with feedback, an explanation, or the pending question. Do not substitute a report about tool calls or retries for the lesson.
- Test and generic scratchpads have no topic-plan gate. Test questions and answers are maintained by test tools; generic markdown is maintained by generic_updateScratchpad.
- Each scratchpad folder contains scratchpad.md, scratchpad.state.json, and assets. Tool writes stage in one transaction. Save the private chat handoff with save_learning_state before replying.
- Native shell and delegation are unavailable. Use provider web search/page tools for online sources. If unavailable, disclose it and keep sources verifiable.

Explicit scratchpad mentions or instructions take precedence over the open scratchpad.
Scratchpad creation requested: ${scratchpadRequested}.
Explicit creation command this turn: ${command ? `${command.command}; create a ${command.type} scratchpad. Learner instruction: ${JSON.stringify(command.instruction)}` : "none; infer type from the learner request and context"}.
Opened scratchpad: ${job.openedScratchpadId ? scratchpadHandles.handle(job.openedScratchpadId) : "none"}.
Plan confirmed this turn: ${job.confirmScratchpadId ? scratchpadHandles.handle(job.confirmScratchpadId) : "none"}.
${visualizationInstructions}
Chat materials: ${JSON.stringify(describe(job.chat.materials))}
Chat handoff: ${JSON.stringify(mapTopicReferenceIds(z.json().parse(JSON.parse(JSON.stringify(job.chat.learning))), scratchpadHandles.referenceHandle))}
Workspace scratchpad directory: ${JSON.stringify(job.workspaceScratchpads.map((scratchpad) => ({ id: scratchpadHandles.handle(scratchpad.id), type: scratchpad.state?.type ?? "topic", title: scratchpad.title, archived: scratchpad.archived, access: job.scratchpads.some((tagged) => tagged.id === scratchpad.id && !tagged.archived) ? "read/write" : "read", notesCharacters: scratchpad.notes.length })))}
Focused scratchpads: ${JSON.stringify(mapTopicReferenceIds(z.json().parse(JSON.parse(JSON.stringify(focusedScratchpads))), scratchpadHandles.referenceHandle))}`
  const sources = [
    ...job.chat.materials.map((material) => ({
      material,
      directory: job.assetDirectory,
    })),
    ...[...job.scratchpads, ...job.workspaceScratchpads].flatMap((scratchpad) =>
      (scratchpad.materials ?? []).map((material) => ({
        material,
        directory: scratchpad.assetDirectory ?? job.assetDirectory,
      })),
    ),
  ]
  const readPages = new Map<string, Set<number>>()
  for (const entry of stage?.readEvidence ?? []) {
    const pages = readPages.get(entry.materialId) ?? new Set<number>()
    pages.add(entry.page)
    readPages.set(entry.materialId, pages)
  }
  function requireMaterialGrounding(parts: z.infer<typeof TopicStateSchema>["content"], materials: WorkerJob["chat"]["materials"], materialIds?: string[]) {
    const referencedIds = new Set<string>()
    const missingPages = new Map<string, Set<number>>()
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
            if (!readPages.get(material.id)?.has(page)) {
              const missing = missingPages.get(material.name) ?? new Set<number>()
              missing.add(page)
              missingPages.set(material.name, missing)
            }
          }
        }
      }
      if (materials.length && !attached)
        throw new Error(`Part "${part.name}" must reference the attached materials. Websites may supplement them, but cannot replace them.`)
    }
    if (missingPages.size)
      throw new Error(`Read all cited pages before using this content: ${[...missingPages].map(([name, pages]) => `${name}, pages ${[...pages].sort((left, right) => left - right).join(", ")}`).join("; ")}. Read the missing source content, then retry the write.`)
    return [...referencedIds]
  }
  let staged = WorkspaceSchema.parse({ version: 2, runners: [job.runner], chats: [job.chat], scratchpads: job.scratchpads })
  for (const scratchpad of job.workspaceScratchpads) {
    if (!staged.scratchpads.some((item) => item.id === scratchpad.id)) {
      staged.scratchpads.push({ ...job.scratchpads[0], id: scratchpad.id, title: scratchpad.title, archived: scratchpad.archived, createdAt: scratchpad.state?.createdAt ?? new Date().toISOString(), titleGenerated: false, materials: scratchpad.materials ?? [], planConfirmed: false, state: scratchpad.state ?? freshTopicState(scratchpad.title, new Date().toISOString()), learning: { ...job.chat.learning, notes: scratchpad.notes } })
    }
  }
  for (const scratchpad of staged.scratchpads) {
    if (!scratchpad.state || scratchpad.state.type === "generic") continue
    scratchpad.state = importStructuredContent(scratchpad.state, scratchpad.learning.notes)
    if (scratchpad.state.type !== "generic") scratchpad.learning.notes = scratchpadMarkdown(scratchpad.state, scratchpad.materials)
  }
  const scratchpadMutations: z.infer<typeof ScratchpadMutationSchema>[] = [...(stage?.priorMutations ?? [])]
  const writable = new Set(job.scratchpads.filter((scratchpad) => !scratchpad.archived).map((scratchpad) => scratchpad.id))
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
  for (const mutation of stage?.operations ?? []) {
    await stateService.write(mutation)
    scratchpadMutations.push(mutation)
    if (["createTopic", "createTest", "createGeneric"].includes(mutation.type)) {
      writable.add(mutation.scratchpadId)
      scratchpadHandles.register(mutation.scratchpadId)
    }
  }
  let saved: LearningState | undefined
  const saveErrors = new Map<string, string>()
  const writePrerequisites = new Map<string, WritePrerequisiteError>()
  const pendingPhases = ["awaiting_answer", "awaiting_clarification", "contested"]
  const questionText = (text: string) => text.replace(/\s+/g, " ").trim()
  function activeTopicParts() {
    return staged.scratchpads.flatMap((scratchpad) => {
      if (!writable.has(scratchpad.id) || scratchpad.archived || !scratchpad.planConfirmed || scratchpad.state?.type !== "topic") return []
      const progress = scratchpad.state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress ?? {}
      return Object.entries(progress).filter(([id, part]) => part.status === "active" && scratchpad.state?.type === "topic" && scratchpad.state.content.some((entry) => entry.id === id))
        .map(([partId, part]) => ({ scratchpadId: scratchpad.id, partId, ...part }))
    })
  }
  function hasFocusedTopic() {
    return staged.scratchpads.some((scratchpad) => focusedIds.has(scratchpad.id) && writable.has(scratchpad.id)
      && scratchpad.planConfirmed && scratchpad.state?.type === "topic" && scratchpad.state.content.length > 0)
  }
  function lessonBody(fallback: string) {
    const mutation = scratchpadMutations.findLast((mutation) =>
      (mutation.type === "editTopicContent" || mutation.type === "editTestContent") && mutation.present?.length)
    if (!mutation || (mutation.type !== "editTopicContent" && mutation.type !== "editTestContent")) return fallback
    const scratchpad = staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)
    if (!scratchpad?.state || scratchpad.state.type === "generic") return fallback
    return (mutation.present ?? []).map((id) => {
      const block = scratchpad.state?.type !== "generic" ? scratchpad.state?.document?.blocks.find((block) => block.id === id) : undefined
      if (!block) throw new Error(`Presented content block not found: ${id}`)
      return renderContentBlock(block, scratchpad.materials)
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
    if (saved.pendingQuestion && !saved.responseQuestion) {
      if (saved.phase === "awaiting_clarification" && !saved.pendingCheck) {
        reply += `\n\n${saved.pendingQuestion}`
      } else {
        reply += `\n\n> [!CHECK]\n${saved.pendingQuestion.split("\n").map((line) => `> ${line}`).join("\n")}`
      }
    }
    return reply.trim()
  }
  function learningStateError(state: LearningState) {
    const active = activeTopicParts()
    const requiresCheck = active.length > 0 || (hasFocusedTopic() && (state.phase !== "awaiting_clarification" || state.pendingCheck !== undefined))
    if (pendingPhases.includes(state.phase) && requiresCheck && !active.some((part) => {
      if (state.pendingCheck?.scratchpadId !== part.scratchpadId || state.pendingCheck.scratchpadPartId !== part.partId) return false
      const step = part.steps[state.pendingCheck.stepIndex]
      return state.pendingCheck.stepIndex >= (part.steps.at(-1)?.reviewStartIndex ?? 0) && state.pendingCheck.stepIndex === part.steps.length - 1 && step !== undefined && (step.answerFromUser === undefined || state.phase === "awaiting_clarification")
    })) {
      return "A Topic check must be registered in the current thread before display. Use topic_recordQuestion with resumeFrom for another thread's latest check, then use its returned pendingCheck. Clarify the same check with awaiting_clarification; do not select an older unrelated check."
    }
  }
  const completion = Promise.withResolvers<void>()
  function targetForCompletion(scratchpadId: string, partId: string) {
    const state = staged.scratchpads.find((scratchpad) => scratchpad.id === scratchpadId)?.state
    if (state?.type !== "topic") return
    const part = state.content.find((part) => part.id === partId)
    const progress = state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress[partId]
    if (!part || !progress) return
    const evidence = topicCompletionEvidence(part, progress)
    if (evidence.complete) return evidence.key
  }

  const session = {
    completion: completion.promise,
    resumeProviderSession: false,
    async recordMaterialRead(id: string, firstPage: number, lastPage: number) {
      const material = sources.find((entry) => entry.material.id === id)?.material
      if (!material || firstPage < 1 || lastPage < firstPage || lastPage > (material.pages.length || 1))
        throw new Error("The cached review is outside the granted source.")
      await stage?.recordRead?.(id, firstPage, lastPage)
      const pages = readPages.get(id) ?? new Set<number>()
      for (let page = firstPage; page <= lastPage; page++) pages.add(page)
      readPages.set(id, pages)
    },
    instructions: scratchpadHandles.modelText(instructions),
    tools,
    modelText: scratchpadHandles.modelText,
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
          { type: "text", text: `Attached image: ${source.material.name}. Source: edu-source://${id}/1` },
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
          if (serialized) input = mapTopicReferenceIds(z.json().parse(JSON.parse(scratchpadHandles.storageText(serialized))), (id) => scratchpadHandles.resolve(id, false))
        }
        if (roleTool) {
          if (roleTool.creation && command && roleTool.role !== command.type)
            throw new WritePrerequisiteError(`${command.command} requires creating a ${command.type} scratchpad with its matching role tool.`, "creation")
          const argumentsObject = z.record(z.string(), z.json()).parse(input)
          const identity = z.object({ threadId: z.string().optional() }).parse(argumentsObject)
          if (identity.threadId !== undefined && identity.threadId !== job.chat.id) throw new Error("Only the current thread's progress can be accessed or written.")
          if (roleTool.operation === "getMistakesForTopic") {
            const { scratchpads } = z.object({ scratchpads: z.array(z.string()).nullable() }).parse(argumentsObject)
            input = { ...argumentsObject, scratchpads: scratchpads?.map((handle) => scratchpadHandles.resolve(handle, false)) ?? null }
          } else if (!roleTool.creation) {
            let scratchpadId
            try {
              scratchpadId = scratchpadHandles.resolve(argumentsObject[roleTool.target] ?? null, writer)
            } catch (error) {
              if (writer && scratchpadRequested && writable.size === 0 && error instanceof Error)
                throw new WritePrerequisiteError(error.message, "creation")
              throw error
            }
            const target = staged.scratchpads.find((item) => item.id === scratchpadId)
            if ((target?.state?.type ?? "topic") !== roleTool.role)
              throw new Error(`${name} requires a ${roleTool.role} scratchpad. This target is ${target?.state?.type ?? "topic"}.`)
            input = { ...argumentsObject, scratchpadId }
            if (writer) saveKey = `${name}:${scratchpadHandles.handle(scratchpadId)}`
          }
        }
        if (name === "list_scratchpads") {
          const { query, type, includeArchived, offset, limit } = ScratchpadDirectorySchema.parse(input)
          const directory = staged.scratchpads.filter((scratchpad) => (!type || (scratchpad.state?.type ?? "topic") === type) && (includeArchived || !scratchpad.archived) && scratchpad.title.toLowerCase().includes(query.toLowerCase()))
          if (offset > directory.length) throw new Error("Offset is outside the scratchpad directory.")
          const page = directory.slice(offset, offset + limit)
          let nextOffset: number | null = null
          if (offset + page.length < directory.length) nextOffset = offset + page.length
          result = JSON.stringify({ scratchpads: page.map((scratchpad) => ({ handle: scratchpadHandles.handle(scratchpad.id), title: scratchpad.title, type: scratchpad.state?.type ?? "topic", archived: scratchpad.archived, writable: writable.has(scratchpad.id) })), nextOffset, total: directory.length })
        } else if (name === "read_skill") {
          const { path } = z.object({ path: z.enum(skillFiles) }).parse(input)
          if (stage?.skillPaths && !stage.skillPaths.includes(path)) throw new Error("This skill is not granted to the current role.")
          activity("Reading tutoring guidance")
          result = await readFile(join(job.skillDirectory, path), "utf8")
        } else if (name === "test_getCoveredTopics") {
          const { scratchpads, offset, limit } = CoverageQuerySchema.parse(input)
          const scratchpadIds = scratchpads?.map((handle) => scratchpadHandles.resolve(handle, false)) ?? savedTestScope
          const entries = staged.scratchpads.flatMap((scratchpad) => {
            const state = scratchpad.state
            if (state?.type !== "topic" || (scratchpadIds && !scratchpadIds.includes(scratchpad.id))) return []
            return state.content.flatMap((part) => {
              const coverage = topicPartCoverage(state, part)
              if (coverage.coverage === "untaught") return []
              return [{ scratchpadId: scratchpadHandles.handle(scratchpad.id), title: scratchpad.title, archived: scratchpad.archived, part: {
                id: part.id, parent: part.parent, name: part.name, plannedObjectives: part.goals.map((goal) => goal.objective), mistakeCount: part.mistakes.length, ...coverage,
              } }]
            })
          })
          if (offset > entries.length) throw new Error("Offset is outside the covered topic inventory.")
          const page = entries.slice(offset, offset + limit)
          const inventory = [...new Set(page.map((entry) => entry.scratchpadId))].map((scratchpadId) => {
            const scratchpad = page.find((entry) => entry.scratchpadId === scratchpadId)!
            return { scratchpadId, title: scratchpad.title, archived: scratchpad.archived, parts: page.filter((entry) => entry.scratchpadId === scratchpadId).map((entry) => entry.part) }
          })
          let nextOffset: number | null = null
          if (offset + page.length < entries.length) nextOffset = offset + page.length
          result = JSON.stringify({ scratchpads: inventory, offset, nextOffset, totalParts: entries.length })
        } else if (name === "read_topic_evidence") {
          const { scratchpadId: handle, scratchpadPartId, offset, limit } = ReadTopicEvidenceSchema.parse(input)
          const scratchpadId = scratchpadHandles.resolve(handle, false)
          const scratchpad = staged.scratchpads.find((scratchpad) => scratchpad.id === scratchpadId)
          const state = scratchpad?.state
          if (state?.type !== "topic") throw new Error("Teaching evidence requires a topic scratchpad.")
          const part = state.content.find((part) => part.id === scratchpadPartId)
          if (!part) throw new Error("Topic part not found.")
          const evidence = JSON.stringify(mapTopicReferenceIds(z.json().parse({ part,
            threads: state.threadTutors.flatMap((thread) => {
              const progress = thread.progress[part.id]
              if (progress) return [{ threadId: thread.id, progress }]
              return []
            }),
            blocks: state.document?.blocks.filter((block) => block.type !== "term" && block.sectionId === part.id) ?? [],
          }), scratchpadHandles.referenceHandle))
          if (offset > evidence.length) throw new Error("Offset is outside this topic part's evidence.")
          const end = Math.min(offset + limit, evidence.length)
          let nextOffset: number | null = null
          if (end < evidence.length) nextOffset = end
          result = JSON.stringify({ scratchpadId: handle, scratchpadPartId, ...topicPartCoverage(state, part), evidence: evidence.slice(offset, end), offset, nextOffset, totalCharacters: evidence.length })
        } else if (name === "read_scratchpad") {
          const argumentsObject = z.object({ scratchpadId: TopicHandleSchema, offset: ReadTopicNotesSchema.shape.offset, limit: ReadTopicNotesSchema.shape.limit }).parse(input)
          const scratchpadId = scratchpadHandles.resolve(argumentsObject.scratchpadId, false)
          const { offset, limit } = argumentsObject
          const scratchpad = staged.scratchpads.find((item) => item.id === scratchpadId)
          if (!scratchpad) throw new Error("Topic not found in this workspace.")
          const notes = scratchpad.learning.notes
          if (offset > notes.length) throw new Error("Offset is outside this topic's notes.")
          const end = Math.min(offset + limit, notes.length)
          let nextOffset: number | null = null
          if (end < notes.length) nextOffset = end
          activity(`Reading ${scratchpad.title} study history`)
          result = JSON.stringify({
            scratchpadId: scratchpadHandles.handle(scratchpadId), type: scratchpad.state?.type ?? "topic", roleSkill: `skills/MANAGE_${(scratchpad.state?.type ?? "topic").toUpperCase()}.md`, state: scratchpad.state, title: scratchpad.title, archived: scratchpad.archived,
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
          let pages = material.pages.length ? material.pages : [material.text]
          if (job.sourceCacheDirectory && material.kind === "pdf" && pages.slice(firstPage - 1, lastPage).some((page) => page.trim().length < 80)) {
            const cached = await readCachedExtraction(await readFile(join(directory, material.name)), extname(material.name).toLowerCase(), job.sourceCacheDirectory)
            if (cached?.pages.length === pages.length) pages = cached.pages
          }
          if (firstPage > pages.length || lastPage > pages.length)
            throw new Error("Page is outside this source.")
          result = `Source: ${material.name}\nScratchpad reference path: assets/${material.name}\nSource link: [${material.name}, pg. ${firstPage}${lastPage > firstPage ? `-${lastPage}` : ""}](edu-material://${id}/${firstPage})\n\n` + pages
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
              const url = `edu-source://${id}/${page}`
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
          await stage?.recordRead?.(id, firstPage, lastPage)
          const read = readPages.get(id) ?? new Set<number>()
          for (let page = firstPage; page <= lastPage; page++) read.add(page)
          readPages.set(id, read)
        } else if (roleTool) {
          const operation = roleTool.operation
          const argumentsObject = z.record(z.string(), z.json()).parse(input)
          if (operation === "getMistakesForTopic") {
            const mistakes = await stateService.getMistakesForTopic(MistakesSchema.parse(input).scratchpads)
            result = JSON.stringify(mistakes.map((mistake) => ({ ...mistake, scratchpadId: scratchpadHandles.handle(mistake.scratchpadId) })))
          } else if (!roleTool.writer) {
            const { scratchpadId, threadId } = TopicReadSchema.parse(input)
            if (operation === "whereAmI" && roleTool.role === "topic") result = JSON.stringify(await stateService.whereAmI(scratchpadId))
            else if (operation === "whereAmI") result = JSON.stringify(await stateService.whereAmIForTest(scratchpadId))
            else if (operation === "getTopicProgress") result = JSON.stringify(await stateService.getTopicProgress(scratchpadId))
            else if (operation === "whatIsNext") result = JSON.stringify(await stateService.whatIsNext(scratchpadId))
            else if (operation === "getQuestions" && roleTool.role === "topic") {
              const questions = await stateService.getQuestions(scratchpadId, QuestionsSchema.parse(input).scratchpadPartId)
              result = JSON.stringify(questions.filter((question) => threadId === undefined || question.threadId === threadId))
            }
            else if (operation === "getQuestions") result = JSON.stringify(await stateService.getTestQuestions(scratchpadId))
            else if (operation === "getTestMistakes") result = JSON.stringify(await stateService.getTestMistakes(scratchpadId))
            else if (operation === "getGenericReferences") result = JSON.stringify(await stateService.getGenericReferences(scratchpadId))
            else throw new Error("This role tool is not available.")
          } else {
            const mutation = ScratchpadMutationSchema.parse({ ...argumentsObject, type: operation, ...(roleTool.creation ? { scratchpadId: stage?.creationId ?? randomUUID(), createdAt: new Date().toISOString() } : {}) })
            if (mutation.type === "complete" && stage?.topicWorkflow) {
              const evidenceKey = targetForCompletion(mutation.scratchpadId, mutation.scratchpadPartId)
              if (evidenceKey === undefined)
                throw new TopicCheckBlockedError("All required criteria need current valid demonstrated evidence before completing this part. Continue with remaining material or defer this part with its gaps preserved.")
              mutation.evidenceKey = evidenceKey
            }
            if (mutation.type === "recordAnswer") {
              const learner = job.chat.messages.findLast((message) => message.role === "user" && message.content === mutation.answerFromUser)
              mutation.answerMessageId = learner?.id
              if (stage?.topicWorkflow && mutation.assessment) {
                const state = staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)?.state
                if (state?.type === "topic") {
                  const steps = state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress[mutation.scratchpadPartId]?.steps ?? []
                  const step = steps[mutation.stepIndex]
                  if (JSON.stringify(step?.assessment) === JSON.stringify(mutation.assessment)) mutation.assessmentOrder = step?.assessmentOrder
                  else mutation.assessmentOrder = Math.max(steps.length, ...steps.map((entry) => entry.assessmentOrder ?? 0)) + 1
                }
              }
            }
            if (mutation.type === "recordQuestion" && rejectsRepeatedChecks(request?.content ?? ""))
              throw new TopicCheckBlockedError("The learner objected to repeated checks. Acknowledge the feedback, explain directly, and continue without a check in this reply. Retain genuine uncertainty for later review.")
            const target = staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)
            if (mutation.type === "recordQuestion" && !mutation.check && !mutation.resumeFrom && target?.state?.type === "topic"
              && target.state.content.find((part) => part.id === mutation.scratchpadPartId)?.goals.length)
              throw new Error("Supply check with an existing goalIndex, criterionIndex, reasoningTask, missingEvidence and expectedEvidence before recording a question.")
            const replayed = (stage?.persist || (mutation.type === "updateTopic" && mutation.changes)) && scratchpadMutations.some((previous) => scratchpadOperationId("", previous) === scratchpadOperationId("", mutation))
            let changedContent: z.infer<typeof TopicStateSchema>["content"] = []
            let revisedTopic
            if (mutation.type === "updateTopic") {
              if (mutation.content !== undefined) throw new Error("Use explicit changes with add, update, remove or move. Omitted parts are preserved; content replacement is unavailable.")
              const current = TopicStateSchema.parse(target?.state)
              if (mutation.changes && !replayed) {
                revisedTopic = applyTopicChanges(current, mutation.changes)
                changedContent = revisedTopic.content.filter((part) => {
                  const previous = current.content.find((entry) => entry.id === part.id)
                  return !previous || JSON.stringify(previous.goals) !== JSON.stringify(part.goals) || JSON.stringify(previous.references) !== JSON.stringify(part.references)
                })
              }
              mutation.expectedRevision ??= current.revision
            }
            let draftContent
            if (mutation.type === "createTopic") draftContent = mutation.scratchpad.content
            if (mutation.type === "updateTopic" && !target?.planConfirmed) draftContent = revisedTopic?.content
            if (draftContent?.some((part) => !part.references.length))
              throw new Error("Every draft curriculum part needs source references from an existing walkthrough. Research sources before proposing a plan.")
            const materials = [...new Map([...job.chat.materials, ...(target?.materials ?? [])].map((material) => [material.id, material])).values()]
            if (mutation.type === "createTopic") {
              if (materials.length && !mutation.scratchpad.content.length)
                throw new Error("Read the attached materials and propose a source-linked curriculum before creating the topic.")
              const referencedIds = requireMaterialGrounding(mutation.scratchpad.content, materials, mutation.materialIds)
              const planningMaterials = [...new Map([
                ...materials,
                ...sources.map(({ material }) => material).filter((material) => referencedIds.includes(material.id)),
              ].map((material) => [material.id, material])).values()]
              mutation.materialIds = [...new Set([
                ...referencedIds,
                ...planningMaterials.map((material) => material.id),
              ])]
            }
            if (mutation.type === "updateTopic" && changedContent.length) {
              requireMaterialGrounding(changedContent, materials, mutation.materialIds)
            }
            if (mutation.type === "editTopicContent" || mutation.type === "editTestContent") {
              for (const change of mutation.changes) {
                if (change.action === "delete" || change.block.type !== "source") continue
                if (!readPages.get(change.block.materialId)?.has(change.block.page))
                  throw new Error(`Read content source ${change.block.materialId}, page ${change.block.page}, before citing it.`)
              }
            }
            if (!roleTool.creation) {
              if (!writable.has(mutation.scratchpadId)) throw new Error("Only tagged or newly created scratchpads can be written.")
              if (roleTool.role === "topic" && !target?.planConfirmed && mutation.type !== "updateTopic")
                throw new WritePrerequisiteError("Wait for the learner to confirm the proposed plan. Present the plan and save phase awaiting_plan_confirmation; do not retry teaching before approval.", "confirmation", mutation.scratchpadId)
              if ((mutation.type === "editTopicContent" || mutation.type === "editTestContent") && target?.state && target.state.type !== "generic") mutation.expectedRevision = target.state.revision
              if (mutation.type === "updateGeneric" && target) mutation.expectedSummary = target.learning.notes
              if (mutation.type === "updateTest" && target) mutation.expectedState = TestStateSchema.parse(target.state)
            }
            const existing = existingScratchpadForCreation(staged, job.chat.id, mutation)
            if (replayed) {
              result = JSON.stringify({ scratchpadId: scratchpadHandles.handle(mutation.scratchpadId), type: roleTool.role, staged: true, reused: true })
            } else if (existing) {
              result = JSON.stringify({ scratchpadId: scratchpadHandles.handle(existing.id), type: existing.state?.type, staged: true, reused: true, nextAction: "Use the matching update tool to revise this scratchpad." })
            } else {
              const before = structuredClone(staged)
              try {
                await stateService.write(mutation)
                if ("materialIds" in mutation && mutation.type !== "updateTopic") mutation.materialIds = staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)?.materials.map((material) => material.id)
                await stage?.persist?.(mutation)
              } catch (error) {
                staged = before
                throw error
              }
              scratchpadMutations.push(mutation)
              if (roleTool.creation) {
                writable.add(mutation.scratchpadId)
                scratchpadHandles.register(mutation.scratchpadId)
              }
              if (mutation.type === "updateTopic") saved = undefined
              activity("Staging scratchpad state")
              let nextAction = "Maintain this scratchpad with its matching role tools."
              if (mutation.type === "createTopic") nextAction = "Present the proposed plan and save phase awaiting_plan_confirmation. Wait for learner approval before activating parts or recording questions."
              if (mutation.type === "createTopic" && stage?.persist) nextAction = "The planning role is complete. The host will validate and commit before Tutor presents the plan for learner confirmation."
              result = JSON.stringify({ scratchpadId: scratchpadHandles.handle(mutation.scratchpadId), type: roleTool.role, staged: true, nextAction, ...((mutation.type === "updateTopic" || mutation.type === "editTopicContent" || mutation.type === "editTestContent") && { state: staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)?.state }) })
            }
            if (mutation.type === "recordQuestion") {
              const state = staged.scratchpads.find((scratchpad) => scratchpad.id === mutation.scratchpadId)?.state
              if (state?.type !== "topic") throw new Error("A recorded check requires a topic.")
              const steps = state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress[mutation.scratchpadPartId]?.steps ?? []
              let stepIndex = steps.length - 1
              if (mutation.resumeFrom) stepIndex = steps.findIndex((step) => step.resumeFrom?.threadId === mutation.resumeFrom?.threadId && step.resumeFrom?.stepIndex === mutation.resumeFrom?.stepIndex)
              result = JSON.stringify({ ...z.record(z.string(), z.json()).parse(JSON.parse(result)), pendingCheck: {
                scratchpadId: scratchpadHandles.handle(mutation.scratchpadId), scratchpadPartId: mutation.scratchpadPartId, stepIndex,
              } })
            }
          }
        } else if (name === "save_learning_state") {
          saved = undefined
          const handoff = SaveLearningStateInputSchema.parse(input)
          if (pendingPhases.includes(handoff.phase) && rejectsRepeatedChecks(request?.content ?? ""))
            throw new TopicCheckBlockedError("The learner objected to repeated checks. Save ready_to_continue with no question, retain genuine uncertainty, and respond directly.")
          const active = activeTopicParts()
          const unanswered = active.flatMap((part) => {
            const stepIndex = part.steps.length - 1
            const step = part.steps[stepIndex]
            if (!step || stepIndex < (step.reviewStartIndex ?? 0) || (step.answerFromUser !== undefined && handoff.phase !== "awaiting_clarification")) return []
            return [{ scratchpadId: part.scratchpadId, scratchpadPartId: part.partId, stepIndex, question: step.question }]
          })
          let pendingQuestion = handoff.question ?? handoff.pendingQuestion
          let pendingCheck: LearningState["pendingCheck"]
          const requiresCheck = active.length > 0 || (hasFocusedTopic() && (handoff.phase !== "awaiting_clarification" || handoff.pendingCheck !== undefined))
          if (pendingPhases.includes(handoff.phase) && requiresCheck) {
            let selected
            if (handoff.pendingCheck) {
              const scratchpadId = scratchpadHandles.resolve(handoff.pendingCheck.scratchpadId, false)
              selected = unanswered.find((step) => step.scratchpadId === scratchpadId && step.scratchpadPartId === handoff.pendingCheck?.scratchpadPartId && step.stepIndex === handoff.pendingCheck.stepIndex)
            } else if (unanswered.length === 1) selected = unanswered[0]
            if (!selected) throw new Error("A Topic check must be registered in the current thread before display. Use topic_recordQuestion with resumeFrom for another thread's latest check, then use its returned pendingCheck. Clarify the same check with awaiting_clarification and question; do not revive an older check or create a new assessment just to clarify the current one.")
            pendingCheck = { scratchpadId: selected.scratchpadId, scratchpadPartId: selected.scratchpadPartId, stepIndex: selected.stepIndex }
            pendingQuestion = selected.question
            if (handoff.phase === "awaiting_clarification" && handoff.question?.trim()) pendingQuestion = handoff.question
          }
          if (!pendingPhases.includes(handoff.phase)) pendingQuestion = ""
          const candidate = SaveLearningStateSchema.parse({ ...handoff, pendingQuestion, pendingCheck })
          if (handoff.responseOptions)
            candidate.responseQuestion = LearningStateSchema.shape.responseQuestion.unwrap().parse({ prompt: pendingQuestion || handoff.question || "", options: handoff.responseOptions })
          if (candidate.responseQuestion && pendingPhases.includes(candidate.phase))
            candidate.responseQuestion.prompt = pendingQuestion
          const created = scratchpadMutations.some((mutation) => ["createTopic", "createTest", "createGeneric"].includes(mutation.type))
          if (scratchpadRequested && !created && (!job.openedScratchpadId || command !== undefined) && !["awaiting_choice", "awaiting_clarification"].includes(candidate.phase))
            throw new Error("Infer the scratchpad type from this chat and create it with the matching role tool before saving, or ask a focused clarification if the learner's goal is unclear.")
          const draftIds = new Set(staged.scratchpads.filter((scratchpad) => writable.has(scratchpad.id) && !scratchpad.archived && !scratchpad.planConfirmed && scratchpad.state?.type === "topic" && scratchpad.state.content.length > 0).map((scratchpad) => scratchpad.id))
          if (candidate.phase === "awaiting_plan_confirmation" && draftIds.size) {
            delete candidate.responseQuestion
          }
          const error = learningStateError(candidate)
          if (error) throw new Error(error)
          for (const [key, issue] of writePrerequisites) {
            let resolved = false
            if (issue.prerequisite === "creation" && created) {
              const createdTopic = scratchpadMutations.some((mutation) => mutation.type === "createTopic")
              resolved = !createdTopic || (candidate.phase === "awaiting_plan_confirmation" && draftIds.size > 0)
            }
            if (issue.prerequisite === "confirmation" && candidate.phase === "awaiting_plan_confirmation" && issue.scratchpadId && draftIds.has(issue.scratchpadId)) resolved = true
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
          if (error instanceof TopicCheckBlockedError) saveErrors.delete(saveKey)
          else saveErrors.set(saveKey, result)
          writePrerequisites.delete(saveKey)
          if (error instanceof WritePrerequisiteError) writePrerequisites.set(saveKey, error)
        }
      }
      if (success && (roleTool || name === "read_scratchpad" || name === "test_getCoveredTopics")) {
        const parsed = z.json().safeParse(JSON.parse(result))
        if (parsed.success) result = JSON.stringify(mapTopicReferenceIds(parsed.data, scratchpadHandles.referenceHandle))
      }
      return { text: scratchpadHandles.modelText(result), images: sourceImages, success }
    },
    get clarificationQuestion() {
      if (saved?.phase === "awaiting_clarification") return saved.pendingQuestion
    },
    get saved() {
      return saved !== undefined && saveErrors.size === 0 && !learningStateError(saved)
    },
    get saveError() {
      if (saveErrors.size) {
        return scratchpadHandles.modelText([...saveErrors.entries()].map(([key, error]) => `Correct ${key}; save_learning_state cannot repair a rejected scratchpad write. ${error}`).join("\n"))
      }
      if (saved) return learningStateError(saved)
    },
    hasReply(reply: string) {
      return lessonBody(reply).trim().length > 0
    },
    recoveryMessage(reply: string) {
      const request = job.chat.messages.findLast((message) => message.role === "user")
      const error = session.saveError
      return `Internal app correction, not a learner message.\nOriginal learner request: ${JSON.stringify(scratchpadHandles.modelText(request?.content ?? ""))}\n${error ?? "A complete saved handoff and a learner-facing reply are required."}\nRepair outstanding writes with their original tool and target and maintain the scratchpad. Save the private handoff with save_learning_state. Reply to the original learner with only the subject explanation or feedback. The app renders the recorded question; do not repeat it. Place any needed references beside the relevant explanation. Keep internal tool errors, write operations, and retries out of the lesson.`
    },
    previewReply(reply: string) {
      if (saveErrors.size || (saved && learningStateError(saved))) return ""
      return scratchpadHandles.storageText(prepareReply(reply))
    },
    async reconcileTopicProgress() {
      const completed: string[] = []
      if (!stage?.topicWorkflow) return completed
      for (const scratchpad of staged.scratchpads) {
        if (!writable.has(scratchpad.id) || !scratchpad.planConfirmed || scratchpad.state?.type !== "topic") continue
        const progress = scratchpad.state.threadTutors.find((thread) => thread.id === job.chat.id)?.progress ?? {}
        for (const part of scratchpad.state.content) {
          if (progress[part.id]?.status !== "active" || !targetForCompletion(scratchpad.id, part.id)) continue
          const result = await session.execute("topic_complete", { scratchpadId: scratchpadHandles.handle(scratchpad.id), scratchpadPartId: part.id })
          if (!result.success) throw new Error(result.text)
          completed.push(part.id)
        }
      }
      return completed
    },
    finish(reply: string) {
      reply = scratchpadHandles.storageText(prepareReply(reply))
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
        scratchpadUpdates: [],
        scratchpadMutations,
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
  return runTutorLoop({
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
