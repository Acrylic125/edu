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
import {
  LearningStateSchema,
  type WorkerJob,
  type LearningState,
  type Diagnostic,
  WorkspaceSchema,
} from "../shared/contracts"
import { TopicMutationSchema, TopicToolNames, TopicStateSchema, TopicPartIdSchema, freshTopicState } from "../shared/topic-state"
import { StateService } from "../main/state-service"
import { runAgentGraph } from "./graph"
import type { TurnTelemetry } from "./telemetry"
import { readSourceImages } from "../main/source-images"
import { parseTopicDirectory, validateTopicDirectory } from "../shared/topic-directory"
import { resolveMaterialLink } from "../shared/material-links"
import { createTopicHandles, TopicHandleSchema } from "./topic-handles"

// Persisted chats may have an empty handoff; tool submissions must be ready to publish.
const SaveLearningStateSchema = LearningStateSchema.safeExtend({
  workpad: LearningStateSchema.shape.workpad.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Private handoff for the next turn. If no question is pending, record the current status explicitly."),
  nextAction: LearningStateSchema.shape.nextAction.min(1, "A private handoff and a concrete next action are required.").regex(/\S/, "A private handoff and a concrete next action are required.").describe("Concrete next action, including waiting for the learner when appropriate."),
})

export const skillFiles = [
  "references/FILE_STRUCTURE.md",
  "references/FAST_IO.md",
  "references/TUTOR_EXPLANATION.md",
  "references/TUTOR_QUESTIONS_AND_DELIBERATE.md",
  "references/WHAT_IS_UNDERSTANDING.md",
  "references/SOFTWARE_CONSTRUCTION.md",
  "assets/GUIDE_DOCUMENT_TEMPLATE.md",
] as const

const ReadMaterialSchema = z.object({
  id: z.string().uuid(),
  firstPage: z.number().int().min(1),
  lastPage: z.number().int().min(1),
  includeVisuals: z.boolean().default(false),
})
const ReadTopicNotesSchema = z.object({
  topicId: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20_000).default(20_000),
})
const TopicReadSchema = z.object({ topicId: z.uuid(), threadId: z.string().optional() })
const QuestionsSchema = z.object({ topicId: z.uuid(), topicPartId: TopicPartIdSchema })
const MistakesSchema = z.object({ topics: z.array(z.uuid()).nullable() })
const stateToolDescriptions = {
  getMistakesForTopic: "Read mistakes for evaluation questions or an explicit request. topics=null includes all topics, including archived ones.",
  whereAmI: "Read this thread's active parts and question progress.",
  getTopicProgress: "Read curriculum-ordered progress across threads: covered, completed, active, and untouched parts.",
  whatIsNext: "Read active continuations across threads and the next untouched part. Use on a fresh thread, an explicit request, or after completing a part/step.",
  getQuestions: "Read exact questions and answers across threads for a part. Use for explicit history requests or question deduplication.",
  documentMistake: "Record a confirmed error after deliberation. Include context, issue, rationale, and who made the error.",
  complete: "Finish this thread's part after checks are resolved or explicitly skipped. masteryVerified=false records covered; true records completed and requires evidence for every goal. Keep pending checks active.",
  activatePart: "Mark a visited part active for this thread. Supports revisiting covered or completed parts.",
  createTopic: "Create a topic only on explicit request or for a necessary prerequisite. Returns topicId. Copies referenced supplied assets; materialIds selects ambiguous sources.",
  updateTopic: "Revise curriculum, references, goals, or conceptual summary. Preserve IDs and existing evidence. Copies referenced supplied assets; materialIds selects ambiguous sources.",
  recordQuestion: "Append an exact self-contained prompt to this thread's active part before asking. Keep keys private. Resume pending questions unless explicitly skipped or terminated.",
  recordAnswer: "Save the actual learner answer at this thread's zero-based stepIndex. Preserve original attempts; record retries as new follow-up questions.",
}
const mutationTools: ChatCompletionTool[] = TopicMutationSchema.options.map((schema) => {
  const name = schema.shape.type.value
  if (name === "createTopic") {
    return { type: "function", function: { name, description: stateToolDescriptions[name], parameters: z.toJSONSchema(z.object({ topic: z.object(TopicStateSchema.shape).omit({ createdAt: true, threadTutors: true }), materialIds: z.array(z.uuid()).optional(), threadId: z.string().optional() })) } }
  }
  if (name === "updateTopic") {
    const update = TopicMutationSchema.options.find((option) => option.shape.type.value === "updateTopic")
    if (!update || update.shape.type.value !== "updateTopic") throw new Error("Missing topic update schema.")
    const { type: _type, ...shape } = update.shape
    const parameters = z.toJSONSchema(z.object({ ...shape, topicId: TopicHandleSchema }))
    delete parameters.properties?.expectedSummary
    delete parameters.properties?.expectedContent
    return { type: "function", function: { name, description: stateToolDescriptions[name], parameters } }
  }
  const { type: _type, ...shape } = schema.shape
  return { type: "function", function: { name, description: stateToolDescriptions[name], parameters: z.toJSONSchema(z.object({ ...shape, topicId: TopicHandleSchema, threadId: z.string().optional() })) } }
})

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
        "Read a chat or tagged-topic source. Pages are 1-based. Set includeVisuals=true for visual material. Limit: 15 text pages or 3 visual pages. Embed discussed images with the returned prune-source URL.",
      parameters: z.toJSONSchema(ReadMaterialSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "read_topic_notes",
      description:
        "Read conceptual summaries and legacy notes from any topic, including archived ones. Excludes private handoffs. offset and limit count characters; follow nextOffset until null for a complete review.",
      parameters: z.toJSONSchema(ReadTopicNotesSchema.extend({ topicId: TopicHandleSchema })),
    },
  },
  ...mutationTools,
  { type: "function", function: { name: "getMistakesForTopic", description: stateToolDescriptions.getMistakesForTopic, parameters: z.toJSONSchema(MistakesSchema.extend({ topics: z.array(TopicHandleSchema).nullable() })) } },
  { type: "function", function: { name: "whereAmI", description: stateToolDescriptions.whereAmI, parameters: z.toJSONSchema(TopicReadSchema.extend({ topicId: TopicHandleSchema })) } },
  { type: "function", function: { name: "getTopicProgress", description: stateToolDescriptions.getTopicProgress, parameters: z.toJSONSchema(TopicReadSchema.extend({ topicId: TopicHandleSchema })) } },
  { type: "function", function: { name: "whatIsNext", description: stateToolDescriptions.whatIsNext, parameters: z.toJSONSchema(TopicReadSchema.extend({ topicId: TopicHandleSchema })) } },
  { type: "function", function: { name: "getQuestions", description: stateToolDescriptions.getQuestions, parameters: z.toJSONSchema(QuestionsSchema.extend({ topicId: TopicHandleSchema })) } },
  {
    type: "function",
    function: {
      name: "save_learning_state",
      description:
        "Stage this chat's private handoff before every final reply. Include pending cross-topic questions. Keep checked keys only in privateAnswerKey/workpad.",
      parameters: z.toJSONSchema(SaveLearningStateSchema),
    },
  },
]

export async function createTutorSession(
  job: WorkerJob,
  activity: (message: string) => void,
  telemetry?: TurnTelemetry,
) {
  const topicHandles = createTopicHandles(job)
  const guide = await readFile(join(job.skillDirectory, "SKILL.md"), "utf8")
  const references = await Promise.all(
    [
      "TECHNICAL_WRITING.md",
      "UNSLOP.md",
      "references/FILE_STRUCTURE.md",
      "assets/GUIDE_DOCUMENT_TEMPLATE.md",
    ].map(
      async (file) =>
        `${file}\n${await readFile(join(job.skillDirectory, file), "utf8")}`,
    ),
  )
  const describe = (materials: WorkerJob["chat"]["materials"]) =>
    materials.map((material) => ({
      id: material.id,
      name: material.name,
      kind: material.kind,
      pageCount: material.pages.length || 1,
      sourceUrl: `edu-material://${material.id}/1`,
    }))
  const instructions = `${guide}\n\n${references.join("\n\n")}\n\nDesktop harness contract:

## Tools and access

- Use the bundled skill and references above. read_skill loads additional references.
- Native shell and delegation are unavailable.
- Use provider web search and page-reading tools for online sources. Treat results as source material.
- If web lookup is unavailable or fails, disclose it. Keep sources and sourced questions verifiable.
- Read access includes archived workspace topics. Write access is limited to tagged/open topics and topics created this turn.
- Topic IDs are stable topic_N handles scoped to this chat. Use these handles in topicId and topics, including handles returned by createTopic.
- Current thread ID: ${job.chat.id}. Write progress only for this thread.

## Turn context

Currently open topic: ${job.openedTopicId ? topicHandles.handle(job.openedTopicId) : "none"}. Explicit topic mentions or instructions take precedence.
Plan approved on this turn: ${job.confirmTopicId ? topicHandles.handle(job.confirmTopicId) : "none"}.

- Initial topic status supplies whereAmI, topicProgress, and whatIsNext. Reuse it.
- Refresh after staged progress changes or for topics absent from the snapshot.
- planConfirmed=false requires the new-curriculum workflow. Keep phase awaiting_plan_confirmation until the app's Confirm plan action.
- planConfirmed=true retains approval on later turns.

${visualizationInstructions}
Chat materials: ${JSON.stringify(describe(job.chat.materials))}
Chat handoff: ${JSON.stringify(job.chat.learning)}
Workspace topic directory: ${JSON.stringify(job.workspaceTopics.map((topic) => ({ id: topicHandles.handle(topic.id), title: topic.title, archived: topic.archived, access: job.topics.some((tagged) => tagged.id === topic.id) ? "read/write" : "read", notesCharacters: topic.notes.length })))}
Tagged topics: ${JSON.stringify(job.topics.map((topic) => ({ id: topicHandles.handle(topic.id), title: topic.title, planConfirmed: topic.planConfirmed, materials: describe(topic.materials), state: topic.state ?? freshTopicState(topic.title, topic.createdAt), summary: topic.learning.notes })))}`
  const sources = [
    ...job.chat.materials.map((material) => ({
      material,
      directory: job.assetDirectory,
    })),
    ...job.topics.flatMap((topic) =>
      topic.materials.map((material) => ({
        material,
        directory: topic.assetDirectory,
      })),
    ),
  ]
  let staged = WorkspaceSchema.parse({ version: 2, runners: [job.runner], chats: [job.chat], topics: job.topics })
  for (const topic of job.workspaceTopics) {
    if (!staged.topics.some((item) => item.id === topic.id)) {
      staged.topics.push({ ...job.topics[0], id: topic.id, title: topic.title, archived: topic.archived, createdAt: topic.state?.createdAt ?? new Date().toISOString(), titleGenerated: false, materials: [], planConfirmed: false, state: topic.state ?? freshTopicState(topic.title, new Date().toISOString()), learning: { ...job.chat.learning, notes: topic.notes } })
    }
  }
  const topicMutations: z.infer<typeof TopicMutationSchema>[] = []
  const writable = new Set(job.topics.map((topic) => topic.id))
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
  const initialStatus = await Promise.all(job.topics.map(async (topic) => {
    const current = await stateService.whereAmI(topic.id)
    const progress = await stateService.getTopicProgress(topic.id)
    const continuations = await stateService.whatIsNext(topic.id)
    return {
      topicId: topicHandles.handle(topic.id),
      whereAmI: current.map(({ part, progress }) => ({
        topicPartId: part.id, name: part.name, status: progress.status,
        latestQuestion: progress.steps.at(-1)?.question ?? null,
      })),
      topicProgress: progress.map(({ part, threads }) => ({
        topicPartId: part.id, name: part.name,
        threads: threads.map(({ threadId, progress }) => ({ threadId, status: progress.status })),
      })),
      whatIsNext: continuations.map(({ label, threadId, part, progress }) => ({
        label, threadId, topicPartId: part.id, name: part.name, status: progress?.status ?? null,
      })),
    }
  }))
  let saved: LearningState | undefined
  const saveErrors = new Map<string, string>()
  const session = {
    instructions: topicHandles.modelText(`${instructions}\nInitial topic status: ${JSON.stringify(initialStatus)}`),
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
      const writer = TopicMutationSchema.options.some((schema) => schema.shape.type.value === name)
      if (writer) {
        saveKey = `${name}:invalid`
      } else if (name === "save_learning_state") saveKey = name
      try {
        if (writer || name === "save_learning_state") {
          const serialized = JSON.stringify(input)
          if (serialized) input = z.json().parse(JSON.parse(topicHandles.storageText(serialized)))
        }
        if (name === "read_topic_notes" || TopicToolNames.some((tool) => tool === name)) {
          const argumentsObject = z.record(z.string(), z.json()).parse(input)
          if (name === "getMistakesForTopic") {
            const { topics } = z.object({ topics: z.array(z.string()).nullable() }).parse(argumentsObject)
            input = { ...argumentsObject, topics: topics?.map((handle) => topicHandles.resolve(handle, false)) ?? null }
          } else if (name !== "createTopic") {
            const topicId = topicHandles.resolve(argumentsObject.topicId ?? null, writer)
            input = { ...argumentsObject, topicId }
            if (writer) saveKey = `${name}:${topicHandles.handle(topicId)}`
          }
        }
        if (name === "read_skill") {
          const { path } = z.object({ path: z.enum(skillFiles) }).parse(input)
          activity("Reading tutoring guidance")
          result = await readFile(join(job.skillDirectory, path), "utf8")
        } else if (name === "read_topic_notes") {
          const { topicId, offset, limit } = ReadTopicNotesSchema.parse(input)
          const topic = staged.topics.find((item) => item.id === topicId)
          if (!topic) throw new Error("Topic not found in this workspace.")
          const notes = topic.learning.notes
          if (offset > notes.length) throw new Error("Offset is outside this topic's notes.")
          const end = Math.min(offset + limit, notes.length)
          let nextOffset: number | null = null
          if (end < notes.length) nextOffset = end
          activity(`Reading ${topic.title} study history`)
          result = JSON.stringify({
            topicId: topicHandles.handle(topicId), title: topic.title, archived: topic.archived,
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
              result += `\nSource image page ${page}: ${url}. Embed this image when discussing its visual content. Exclude answer annotations for pending assessments.`
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
        } else if (TopicToolNames.some((tool) => tool === name)) {
          const identity = z.object({ threadId: z.string().optional() }).parse(input)
          if (identity.threadId !== undefined && identity.threadId !== job.chat.id) throw new Error("Only the current thread's progress can be accessed through whereAmI or written.")
          if (name === "getMistakesForTopic") {
            const mistakes = await stateService.getMistakesForTopic(MistakesSchema.parse(input).topics)
            result = JSON.stringify(mistakes.map((mistake) => ({ ...mistake, topicId: topicHandles.handle(mistake.topicId) })))
          } else if (name === "whereAmI") {
            result = JSON.stringify(await stateService.whereAmI(TopicReadSchema.parse(input).topicId))
          } else if (name === "getTopicProgress") {
            result = JSON.stringify(await stateService.getTopicProgress(TopicReadSchema.parse(input).topicId))
          } else if (name === "whatIsNext") {
            result = JSON.stringify(await stateService.whatIsNext(TopicReadSchema.parse(input).topicId))
          } else if (name === "getQuestions") {
            const { topicId, topicPartId } = QuestionsSchema.parse(input)
            result = JSON.stringify(await stateService.getQuestions(topicId, topicPartId))
          } else {
            const argumentsObject = z.record(z.string(), z.json()).parse(input)
            const mutation = TopicMutationSchema.parse({ ...argumentsObject, type: name, ...(name === "createTopic" ? { topicId: randomUUID() } : {}) })
            let draftContent
            if (mutation.type === "createTopic") draftContent = mutation.topic.content
            if (mutation.type === "updateTopic" && !staged.topics.find((topic) => topic.id === mutation.topicId)?.planConfirmed)
              draftContent = mutation.content
            if (draftContent?.some((part) => !part.references.length))
              throw new Error("Every draft curriculum part needs source references from an existing walkthrough. Research sources before proposing a plan.")
            if (mutation.type !== "createTopic") {
              if (!writable.has(mutation.topicId)) {
                throw new Error("Only tagged or newly created topics can be written.")
              }
              const topic = staged.topics.find((topic) => topic.id === mutation.topicId)
              if (!topic?.planConfirmed && mutation.type !== "updateTopic") throw new Error("Wait for the learner to confirm the proposed plan.")
              if (mutation.type === "updateTopic" && topic) {
                if (mutation.summary !== undefined || mutation.content !== undefined || mutation.name !== undefined)
                  mutation.expectedSummary = topic.learning.notes
                if (mutation.content !== undefined) mutation.expectedContent = topic.state?.content ?? []
              }
            }
            if (mutation.type === "updateTopic" && mutation.summary !== undefined && /<topic-directory|^#{1,6}\s+Topic directory\b/im.test(mutation.summary)) {
              validateTopicDirectory(mutation.summary)
              const entries = [...(parseTopicDirectory(mutation.summary).directory?.items ?? [])]
              const materials = [...new Map(sources.map(({ material }) => [material.id, material])).values()]
              for (const entry of entries) {
                entries.push(...entry.children)
                for (const source of entry.sources) {
                  if (!/^https?:\/\//.test(source.href) && !resolveMaterialLink(source.href, materials))
                    throw new Error(`Unknown directory source: ${source.href}. Use the exact supplied material filename or source URL.`)
                }
              }
            }
            await stateService.write(mutation)
            if (mutation.type === "createTopic" || mutation.type === "updateTopic") {
              mutation.materialIds = staged.topics.find((topic) => topic.id === mutation.topicId)?.materials.map((material) => material.id)
            }
            topicMutations.push(mutation)
            if (mutation.type === "createTopic") {
              writable.add(mutation.topicId)
              topicHandles.register(mutation.topicId)
            }
            activity("Staging topic state")
            result = JSON.stringify({ topicId: topicHandles.handle(mutation.topicId), staged: true })
          }
        } else if (name === "save_learning_state") {
          saved = undefined
          const candidate = SaveLearningStateSchema.parse(input)
          saved = candidate
          activity("Saving the chat handoff")
          result =
            "Chat handoff staged. Provide the learner-facing reply. It commits with the staged writes before display."
        } else {
          throw new Error("This tool is not available.")
        }
        if (saveKey) {
          saveErrors.delete(saveKey)
          if (writer) saveErrors.delete(`${name}:invalid`)

        }
      } catch (error) {
        telemetry?.reject()
        success = false
        result = `Tool error: ${error instanceof Error ? error.message : "Invalid tool arguments."}`
        if (saveKey) saveErrors.set(saveKey, result)
      }
      return { text: topicHandles.modelText(result), images: sourceImages, success }
    },
    get saved() {
      return saved !== undefined && saveErrors.size === 0
    },
    get saveError() {
      if (saveErrors.size) {
        return topicHandles.modelText([...saveErrors.entries()].map(([key, error]) => `Correct ${key}; save_learning_state cannot repair a rejected topic write. ${error}`).join("\n"))
      }
    },
    previewReply(reply: string) {
      if (!saved || saveErrors.size) return ""
      reply = topicHandles.storageText(reply)
      const pendingKey = saved.privateAnswerKey.trim()
      if (["awaiting_answer", "awaiting_clarification", "contested"].includes(saved.phase) && pendingKey.length > 20) {
        const keyStart = reply.indexOf(pendingKey)
        if (keyStart !== -1) return reply.slice(0, keyStart)
        // A suffix may become the private key as later chunks arrive; hold only that suffix.
        for (let start = Math.max(0, reply.length - pendingKey.length + 1); start < reply.length; start++) {
          if (reply[start] === pendingKey[0] && pendingKey.startsWith(reply.slice(start)))
            return reply.slice(0, start)
        }
      }
      return reply
    },
    finish(reply: string) {
      reply = topicHandles.storageText(reply)
      if (!saved || saveErrors.size)
        throw new Error(
          [...saveErrors.values()].join("\n") ||
            "The runner did not save a complete learning state. Retry this turn.",
        )
      if (!reply.trim())
        throw new Error("The runner returned no lesson. Retry this turn.")
      const visibleResponse = messageText({ content: reply, responseQuestion: saved.responseQuestion })
      const states = [saved]
      for (const state of states) {
        const pendingKey = state.privateAnswerKey.trim()
        if (
          ["awaiting_answer", "awaiting_clarification", "contested"].includes(state.phase) &&
          pendingKey.length > 20 &&
          states.some(
            (other) => visibleResponse.includes(pendingKey) || other.notes.includes(pendingKey) || staged.topics.some((topic) => topic.learning.notes.includes(pendingKey) || JSON.stringify(topic.state).includes(pendingKey)),
          )
        )
          throw new Error(
            "The runner included a private assessment key in the lesson. Retry with a different runner.",
          )
      }
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
  return runAgentGraph({
    limit: 16,
    diagnostic,
    telemetry,
    runner: job.runner,
    async run(iteration) {
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
      if (response.tool_calls?.length) return "tools"
      return "validate"
    },
    ready: () => session.saved && !!response?.content?.trim(),
    recover() {
      messages.push({
        role: "user",
        content:
          `Save the complete learning state with save_learning_state, then provide the learner-facing reply.${session.saveError ? `\nCorrect rejected saves first: ${session.saveError}` : ""}`,
      })
    },
    async tools() {
      const sourceImages: ChatCompletionContentPart[] = []
      for (const call of response?.tool_calls ?? []) {
        if (call.type !== "function")
          throw new Error("The model requested an unsupported tool.")
        diagnostic("tool.call", { tool: call.function.name })
        let input: Parameters<typeof LearningStateSchema.parse>[0]
        try {
          input = JSON.parse(call.function.arguments)
        } catch {
          // Failed saves must invalidate publication even if an earlier handoff was valid.
          input = null
        }
        const result = await session.execute(call.function.name, input)
        diagnostic("tool.result", {
          tool: call.function.name,
          success: result.success,
          error: result.success ? null : result.text,
        })
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.text,
        })
        sourceImages.push(...result.images)
      }
      if (sourceImages.length)
        messages.push({ role: "user", content: sourceImages })
      return "agent"
    },
    finish: () => session.finish(response?.content ?? ""),
    exhausted: () => new Error(
      "The runner reached its tool limit. Retry with a narrower request.",
    ),
  })
}
