import { randomUUID } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import OpenAI from "openai"
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions"
import { createIsomorphicCanvasFactory, getDocumentProxy, renderPageAsImage } from "unpdf"
import { createCanvas, loadImage } from "@napi-rs/canvas"
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
import { runTutorGraph } from "./tutor-graph"

export const skillFiles = [
  "references/FILE_STRUCTURE.md",
  "references/FAST_IO.md",
  "references/TUTOR_EXPLANATION.md",
  "references/TUTOR_QUESTIONS_AND_DELIBERATE.md",
  "references/TUTOR_TESTS.md",
  "references/WHAT_IS_UNDERSTANDING.md",
  "references/DIFFICULTY_MEMORY.md",
  "references/DIFFICULTY_MEMORY_EVALUATION.md",
  "references/PSEUDOCODE_POC.md",
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
  getMistakesForTopic: "Read structured mistakes for the supplied topics, or all topics including archived topics when topics=null. Call only to create evaluation questions for these topics or when explicitly asked. Read-only.",
  whereAmI: "Read the current thread's active topic parts and question progress. Reading never registers this thread as a tutor.",
  whatIsNext: "Read every active continuation across tutor threads and only the very next part untouched by any thread. Call only for a fresh thread, when explicitly asked, or after completing a part or step. Present multiple choices to the learner.",
  getQuestions: "Read exact questions and learner answers across all tutor threads for a part. Call only when explicitly asked or to deduplicate evaluation questions.",
  documentMistake: "Record context and issue after an incorrect answer has been deliberated and confirmed. Registers this thread as a writer. Distinguish tutor mistakes in the issue.",
  complete: "Mark a part completed for this thread only when all its goals and understoodWhen criteria are satisfied by the learner's reasoning. The tutor must evaluate this. Registers this thread as a writer.",
  activatePart: "Mark a part active when this thread visits it. Completed parts can be reactivated. Registers this thread as a writer.",
  createTopic: "Create a topic folder, topic summary, topic.state.json and assets only when explicitly requested or when a prerequisite topic is necessary. Referenced supplied assets are copied into the new topic; use materialIds to select sources when filenames are ambiguous. Registers this thread as a writer. Returns topicId.",
  updateTopic: "Set curriculum content, references and goals, or revise the topic summary. Keep summaries conceptual; questions, answers, mistakes and progress belong in structured state. Preserve IDs and existing evidence. Referenced supplied assets are copied into this topic; materialIds selects ambiguous source filenames. Registers this thread as a writer.",
  recordQuestion: "Append the exact self-contained question to the current thread's active part before asking it. Resume pending questions unless the learner explicitly skips or terminates them; preserve skipped steps without an answer. Keep the checked key in the private chat handoff. Registers this thread as a writer.",
  recordAnswer: "Save the learner's actual answer at the specified zero-based question stepIndex in this thread. Preserve the original answer; record retries as new follow-up questions. Registers this thread as a writer.",
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
    const parameters = z.toJSONSchema(z.object(shape))
    delete parameters.properties?.expectedSummary
    delete parameters.properties?.expectedContent
    return { type: "function", function: { name, description: stateToolDescriptions[name], parameters } }
  }
  const { type: _type, ...shape } = schema.shape
  return { type: "function", function: { name, description: stateToolDescriptions[name], parameters: z.toJSONSchema(z.object({ ...shape, threadId: z.string().optional() })) } }
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
        "Read a chat or tagged-topic source. Pages are 1-based. Set includeVisuals=true for slides, diagrams, scanned PDFs, or image sources; images are provided after the tool results. Read up to 15 text pages or 3 visual pages at a time. Embed discussed source images using the returned prune-source URL.",
      parameters: z.toJSONSchema(ReadMaterialSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "read_topic_notes",
      description:
        "Read conceptual topic summaries and preserved legacy notes from any workspace topic, including archived topics. Use structured tools for new mistakes and question history. Read-only; no private handoffs or answer keys. offset and limit count characters; follow nextOffset until null for a complete review.",
      parameters: z.toJSONSchema(ReadTopicNotesSchema),
    },
  },
  ...mutationTools,
  { type: "function", function: { name: "getMistakesForTopic", description: stateToolDescriptions.getMistakesForTopic, parameters: z.toJSONSchema(MistakesSchema) } },
  { type: "function", function: { name: "whereAmI", description: stateToolDescriptions.whereAmI, parameters: z.toJSONSchema(TopicReadSchema) } },
  { type: "function", function: { name: "whatIsNext", description: stateToolDescriptions.whatIsNext, parameters: z.toJSONSchema(TopicReadSchema) } },
  { type: "function", function: { name: "getQuestions", description: stateToolDescriptions.getQuestions, parameters: z.toJSONSchema(QuestionsSchema) } },
  {
    type: "function",
    function: {
      name: "save_learning_state",
      description:
        "Stage this chat's private handoff. Required on every turn before your final reply. Record a pending cross-topic question here; keep checked keys only in privateAnswerKey/workpad.",
      parameters: z.toJSONSchema(LearningStateSchema),
    },
  },
]

export async function createTutorSession(
  job: WorkerJob,
  activity: (message: string) => void,
) {
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
Follow the bundled skill. read_material supplies extracted pages and source images. read_skill loads additional guidance. Native shell access and delegation are unavailable. External web search is unavailable in this harness: after exhausting supplied practice sources, explain the limitation and end practice; never present an authored question as an internet source.
This is an independent chat. A topic can be taught by several chat threads. Use structured state tools for all topic progress, questions, answers, and mistakes. All writers register the current app chat ID (${job.chat.id}) as a threadTutor. Never supply another thread's id to write its progress. Read-only references never register a tutor. Topic tool changes are staged, then replayed under the repository mutex against current state and committed with the final reply.
Currently open topic: ${job.openedTopicId ?? "none"}. Explicit topic mentions or instructions take precedence. Read whereAmI for this thread's current part. For a fresh thread, an explicit continuation request, or after completion of a part or step, read whatIsNext. If more than one continuation is returned, ask the learner to choose. A continuation in another thread is evidence to resume from, not permission to overwrite that thread. Activate the chosen part for this thread.
Only tagged/open topics and topics created this turn may be written. Read-only cross-topic reviews include archived topics. getMistakesForTopic retrieves structured mistakes; old Markdown records are legacy evidence and do not establish new structured progress. read_topic_notes reads conceptual summaries and preserved legacy notes.
A tagged topic with planConfirmed=false needs an approved curriculum before teaching. Use updateTopic to propose its content and goals; keep this chat awaiting_plan_confirmation. Only the Confirm plan action approves a plan. Plan approved on this turn: ${job.confirmTopicId ?? "none"}. Persisted planConfirmed=true remains approval on later turns.
topic.md is a conceptual topic summary. Use updateTopic.summary only for subject explanations, worked examples and source references. Use recordQuestion and recordAnswer for exact questions and actual learner answers. Use documentMistake for confirmed mistakes after deliberation. Use complete only when all part goals are satisfied. Keep answer keys, temporary remediation and session logistics in this chat's private handoff. Legacy topic workpads are historical and cannot direct progress.
Call save_learning_state before the final reply. Its notes field is private chat context, not the topic summary. Keep checked keys only in privateAnswerKey/workpad. Repair rejected state writes with the same tool and target before publishing. Provide the learner-facing explanation, question or choice in the final reply.
In chat, cite sources as Sourced from: [Lecture.pdf, pg. 6-7](edu-material://<material-id>/6). For visuals call read_material with includeVisuals=true and embed ![Description](prune-source://<material-id>/<page>). Use relative assets/<filename> links in summaries and paths relative to topic.state.json in structured references. A source reference type is pdf, ppt, image or website. PDF and PPT ranges are 1-based and inclusive.
Chat materials: ${JSON.stringify(describe(job.chat.materials))}
Chat handoff: ${JSON.stringify(job.chat.learning)}
Workspace topic directory: ${JSON.stringify(job.workspaceTopics.map((topic) => ({ id: topic.id, title: topic.title, archived: topic.archived, notesCharacters: topic.notes.length })))}
Tagged topics: ${JSON.stringify(job.topics.map((topic) => ({ id: topic.id, title: topic.title, planConfirmed: topic.planConfirmed, materials: describe(topic.materials), state: topic.state ?? freshTopicState(topic.title, topic.createdAt), summary: topic.learning.notes })))}`
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
  const workspaceTopics = new Map(job.workspaceTopics.map((topic) => [topic.id, topic]))
  for (const topic of job.topics) {
    workspaceTopics.set(topic.id, {
      id: topic.id, title: topic.title, archived: topic.archived, notes: topic.learning.notes,
    })
  }
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
  let saved: LearningState | undefined
  const saveErrors = new Map<string, string>()
  return {
    instructions,
    tools,
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
        const target = z.object({ topicId: z.uuid().optional() }).safeParse(input)
        saveKey = `${name}:${target.success ? target.data.topicId ?? "new" : "invalid"}`
      } else if (name === "save_learning_state") saveKey = name
      try {
        if (name === "read_skill") {
          const { path } = z.object({ path: z.enum(skillFiles) }).parse(input)
          activity("Reading tutoring guidance")
          result = await readFile(join(job.skillDirectory, path), "utf8")
        } else if (name === "read_topic_notes") {
          const { topicId, offset, limit } = ReadTopicNotesSchema.parse(input)
          const topic = workspaceTopics.get(topicId)
          if (!topic) throw new Error("Topic not found in this workspace.")
          const notes = staged.topics.find((item) => item.id === topicId)?.learning.notes ?? topic.notes
          if (offset > notes.length) throw new Error("Offset is outside this topic's notes.")
          const end = Math.min(offset + limit, notes.length)
          let nextOffset: number | null = null
          if (end < notes.length) nextOffset = end
          activity(`Reading ${topic.title} study history`)
          result = JSON.stringify({
            topicId, title: topic.title, archived: topic.archived,
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
            const sourcePath = join(directory, material.name)
            const sourceStat = await stat(sourcePath)
            const cachedPages = await Promise.all(
              Array.from({ length: lastPage - firstPage + 1 }, async (_, index) => {
                const path = join(directory, `source-${id}-${firstPage + index}.png`)
                try {
                  if ((await stat(path)).mtimeMs < sourceStat.mtimeMs) return
                  const png = await readFile(path)
                  if (png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return png
                } catch (error) {
                  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
                }
              }),
            )
            let bytes: Buffer | undefined
            if (cachedPages.some((png) => !png)) bytes = await readFile(sourcePath)
            const pdf =
              material.kind === "pdf" && bytes
                ? await getDocumentProxy(new Uint8Array(bytes), {
                    // PDF.js otherwise picks a DOM canvas in Electron utility processes.
                    CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")),
                  })
                : undefined
            try {
              for (let page = firstPage; page <= lastPage; page++) {
                let png = cachedPages[page - firstPage]
                if (!png) {
                  if (pdf) {
                    png = Buffer.from(
                      await renderPageAsImage(pdf, page, {
                        canvasImport: () => import("@napi-rs/canvas"),
                        scale: 1.3,
                      }),
                    )
                  } else {
                    if (!bytes) throw new Error("Source image is unavailable.")
                    const source = await loadImage(bytes)
                    const scale = Math.min(1, 1600 / Math.max(source.width, source.height))
                    const canvas = createCanvas(
                      Math.max(1, Math.round(source.width * scale)),
                      Math.max(1, Math.round(source.height * scale)),
                    )
                    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height)
                    png = Buffer.from(canvas.toBuffer("image/png"))
                  }
                  await writeFile(join(directory, `source-${id}-${page}.png`), png, { mode: 0o600 })
                }
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
            } finally {
              await pdf?.loadingTask.destroy()
            }
          }
        } else if (TopicToolNames.some((tool) => tool === name)) {
          const identity = z.object({ threadId: z.string().optional() }).parse(input)
          if (identity.threadId !== undefined && identity.threadId !== job.chat.id) throw new Error("Only the current thread's progress can be accessed through whereAmI or written.")
          if (name === "getMistakesForTopic") {
            result = JSON.stringify(await stateService.getMistakesForTopic(MistakesSchema.parse(input).topics))
          } else if (name === "whereAmI") {
            result = JSON.stringify(await stateService.whereAmI(TopicReadSchema.parse(input).topicId))
          } else if (name === "whatIsNext") {
            result = JSON.stringify(await stateService.whatIsNext(TopicReadSchema.parse(input).topicId))
          } else if (name === "getQuestions") {
            const { topicId, topicPartId } = QuestionsSchema.parse(input)
            result = JSON.stringify(await stateService.getQuestions(topicId, topicPartId))
          } else {
            const argumentsObject = z.record(z.string(), z.json()).parse(input)
            const mutation = TopicMutationSchema.parse({ ...argumentsObject, type: name, ...(name === "createTopic" ? { topicId: randomUUID() } : {}) })
            if (mutation.type !== "createTopic") {
              if (!writable.has(mutation.topicId)) throw new Error("Only tagged or newly created topics can be written.")
              const topic = staged.topics.find((topic) => topic.id === mutation.topicId)
              if (!topic?.planConfirmed && mutation.type !== "updateTopic") throw new Error("Wait for the learner to confirm the proposed plan.")
              if (mutation.type === "updateTopic" && topic) {
                if (mutation.summary !== undefined || mutation.content !== undefined || mutation.name !== undefined)
                  mutation.expectedSummary = topic.learning.notes
                if (mutation.content !== undefined) mutation.expectedContent = topic.state?.content ?? []
              }
            }
            await stateService.write(mutation)
            if (mutation.type === "createTopic" || mutation.type === "updateTopic") {
              mutation.materialIds = staged.topics.find((topic) => topic.id === mutation.topicId)?.materials.map((material) => material.id)
            }
            topicMutations.push(mutation)
            if (mutation.type === "createTopic") writable.add(mutation.topicId)
            activity("Staging topic state")
            result = JSON.stringify({ topicId: mutation.topicId, staged: true })
          }
        } else if (name === "save_learning_state") {
          saved = undefined
          const candidate = LearningStateSchema.parse(input)
          if (!candidate.workpad.trim() || !candidate.nextAction.trim())
            throw new Error(
              "A private handoff and a concrete next action are required.",
            )
          saved = candidate
          activity("Saving the chat handoff")
          result =
            "Chat handoff staged. Provide the learner-facing lesson/question/choice now. The harness will atomically save and verify it before displaying your reply."
        } else {
          throw new Error("This tool is not available.")
        }
        if (saveKey) {
          saveErrors.delete(saveKey)
          if (writer) saveErrors.delete(`${name}:invalid`)

        }
      } catch (error) {
        success = false
        result = `Tool error: ${error instanceof Error ? error.message : "Invalid tool arguments."}`
        if (saveKey) saveErrors.set(saveKey, result)
      }
      return { text: result, images: sourceImages, success }
    },
    get saved() {
      return saved !== undefined && saveErrors.size === 0
    },
    get saveError() {
      if (saveErrors.size) {
        return [...saveErrors.entries()].map(([key, error]) => `Correct ${key}; save_learning_state cannot repair a rejected topic write. ${error}`).join("\n")
      }
    },
    finish(reply: string) {
      if (!saved || saveErrors.size)
        throw new Error(
          [...saveErrors.values()].join("\n") ||
            "The runner did not save a complete learning state. Retry this turn.",
        )
      if (!reply.trim())
        throw new Error("The runner returned no lesson. Retry this turn.")
      const states = [saved]
      for (const state of states) {
        const pendingKey = state.privateAnswerKey.trim()
        if (
          ["awaiting_answer", "awaiting_clarification", "contested"].includes(state.phase) &&
          pendingKey.length > 20 &&
          states.some(
            (other) => reply.includes(pendingKey) || other.notes.includes(pendingKey) || staged.topics.some((topic) => topic.learning.notes.includes(pendingKey) || JSON.stringify(topic.state).includes(pendingKey)),
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
}

export async function runTutorTurn(
  job: WorkerJob,
  client: Pick<OpenAI, "chat">,
  activity: (message: string) => void,
  diagnostic: Diagnostic = () => {},
) {
  const session = await createTutorSession(job, activity)
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: session.instructions },
    ...job.chat.messages.map((message) => ({ role: message.role, content: message.content })),
  ]
  return runTutorGraph({
    session,
    maxAttempts: 16,
    diagnostic,
    exhausted: () => new Error("The runner reached its tool limit. Retry with a narrower request."),
    async model(attempt) {
      activity("Preparing your lesson")
      diagnostic("model.request", { iteration: attempt, model: job.runner.model })
      const completion = await client.chat.completions.create({
        model: job.runner.model,
        messages,
        tools: session.tools,
        max_completion_tokens: 12_000,
        stream: false,
      })
      const response = completion.choices[0]?.message
      if (!response) throw new Error("The model returned no response. Try another runner or retry.")
      if (completion.choices[0].finish_reason === "length")
        throw new Error("The lesson exceeded the model response limit. Ask for a smaller section and retry.")
      messages.push(response)
      diagnostic("model.response", {
        iteration: attempt,
        finishReason: completion.choices[0].finish_reason,
        toolCalls: response.tool_calls?.length ?? 0,
        replyCharacters: response.content?.length ?? 0,
        saved: session.saved,
      })
      const calls = (response.tool_calls ?? []).map((call) => {
        if (call.type !== "function") throw new Error("The model requested an unsupported tool.")
        return { id: call.id, name: call.function.name, arguments: call.function.arguments }
      })
      return { reply: response.content ?? "", calls, finishAfterTools: false }
    },
    consumeTools(calls, results) {
      const sourceImages: ChatCompletionContentPart[] = []
      for (const [index, call] of calls.entries()) {
        const result = results[index]
        if (!call.id || !result) throw new Error("A tutoring tool result is missing its call ID.")
        messages.push({ role: "tool", tool_call_id: call.id, content: result.text })
        sourceImages.push(...result.images)
      }
      if (sourceImages.length) messages.push({ role: "user", content: sourceImages })
    },
    recover(message) { messages.push({ role: "user", content: message }) },
  })
}
