import { readFile, writeFile } from "node:fs/promises"
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
} from "../shared/contracts"
import {
  topicDirectoryFormat,
  validateTopicDirectory,
} from "../shared/topic-directory"

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
  "assets/BEHAVIOUR_TEMPLATE.md",
] as const

const ReadMaterialSchema = z.object({
  id: z.string().uuid(),
  firstPage: z.number().int().min(1),
  lastPage: z.number().int().min(1),
  includeVisuals: z.boolean().default(false),
})
const SaveTopicSchema = z.object({
  topicId: z.string().uuid(),
  learning: LearningStateSchema,
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
      name: "save_topic_state",
      description:
        "Stage complete study notes and a private handoff for one tagged topic. Call it for each tagged topic you planned, taught, or assessed this turn. Keep checked keys only in privateAnswerKey/workpad. Preserve prior questions and actual answers.",
      parameters: z.toJSONSchema(SaveTopicSchema),
    },
  },
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
    ["references/FILE_STRUCTURE.md", "assets/GUIDE_DOCUMENT_TEMPLATE.md"].map(
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
Follow the bundled skill. Use read_skill for its additional references. This harness supplies source reads and verified persistence instead of Python scripts or shell commands. No external tools, search, or delegation are available; never pretend to use them. For Tests, inspect supplied assets first, then author and clearly label a question when no asset fits; online search is unavailable.
This is one of the learner's independent chats. A chat can cover several topics, and a topic can be discussed in several chats. The learner tags topics as [@Title](edu-topic://id); tagged topics and topics opened while sending are listed below with their study notes and private handoffs. Without a topic in context, answer directly and suggest tagging a topic for structured study.
Currently open topic: ${job.openedTopicId ?? "none"}. Use this topic's saved progress, pending question, outline, and nextAction for requests such as "What is next?" or "Continue". Explicit topic mentions or instructions take precedence. Do not infer the currently open topic from older chat messages.
A tagged topic with planConfirmed=false needs an approved plan before lessons: read its materials, propose or revise its outline with save_topic_state, keep it awaiting_plan_confirmation, and do not teach or question it. Only the Confirm plan action approves a plan; do not infer approval from a message. Plan approved on this turn: ${job.confirmTopicId ?? "none"}.
Explain lecture material before checking it. Resume a topic's saved question and checked key before moving it forward. Pending answers belong only in privateAnswerKey/workpad, never in notes or learner replies. Honour explicit answer requests as the skill describes.
Call save_topic_state for each tagged topic you planned, taught, or assessed. Full notes replace the old notes, so retain useful explanations, questions, and learner evidence. Keep material links relative as assets/<filename>. Never mark uncovered sections learned.
In chat, use clickable Markdown citations: Sourced from: [Lecture 6.pdf, pg. 6-7.](edu-material://<material-id>/6). Use the actual material id, filename, and first cited page. The app opens the original attached source. For diagrams, call read_material with includeVisuals=true, then embed the returned image as ![Diagram description](prune-source://<material-id>/<page>). The chat supports these images; report an unavailable image only if the visual read fails.
In topic notes, replace the template's "## Topic directory" heading and bullet list with exactly one <topic-directory /> element in the same position. heading is the section heading text. items is single-quoted JSON following the directory rules: title is the source section number and title; anchor is the in-document anchor id, set only when that part's notes exist; sources are its compact source links; children are its subparts in source order. Write any apostrophe inside items as \\u0027. Example:
${topicDirectoryFormat}
Call save_learning_state with this chat's private handoff before the final reply, then deliver the explanation/question/choice in that reply. Saving alone is not a lesson. Workpads are private. The reply is learner-visible.
Chat materials: ${JSON.stringify(describe(job.chat.materials))}
Chat handoff: ${JSON.stringify(job.chat.learning)}
Tagged topics: ${JSON.stringify(job.topics.map((topic) => ({ id: topic.id, title: topic.title, planConfirmed: topic.planConfirmed, materials: describe(topic.materials), learning: topic.learning })))}`
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
  const topicUpdates = new Map<string, LearningState>()
  let saved: LearningState | undefined
  let saveError: string | undefined
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
      try {
        if (name === "read_skill") {
          const { path } = z.object({ path: z.enum(skillFiles) }).parse(input)
          activity("Reading tutoring guidance")
          result = await readFile(join(job.skillDirectory, path), "utf8")
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
            const bytes = await readFile(join(directory, material.name))
            const pdf =
              material.kind === "pdf"
                ? await getDocumentProxy(new Uint8Array(bytes), {
                    // PDF.js otherwise picks a DOM canvas in Electron utility processes.
                    CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")),
                  })
                : undefined
            try {
              for (let page = firstPage; page <= lastPage; page++) {
                let png: Buffer
                if (pdf) {
                  png = Buffer.from(
                    await renderPageAsImage(pdf, page, {
                      canvasImport: () => import("@napi-rs/canvas"),
                      scale: 1.3,
                    }),
                  )
                } else {
                  const source = await loadImage(bytes)
                  const scale = Math.min(
                    1,
                    1600 / Math.max(source.width, source.height),
                  )
                  const canvas = createCanvas(
                    Math.max(1, Math.round(source.width * scale)),
                    Math.max(1, Math.round(source.height * scale)),
                  )
                  canvas
                    .getContext("2d")
                    .drawImage(source, 0, 0, canvas.width, canvas.height)
                  png = canvas.toBuffer("image/png")
                }
                await writeFile(
                  join(directory, `source-${id}-${page}.png`),
                  png,
                  { mode: 0o600 },
                )
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
        } else if (name === "save_topic_state") {
          const { topicId, learning } = SaveTopicSchema.parse(input)
          const topic = job.topics.find((item) => item.id === topicId)
          if (!topic) throw new Error("Only tagged topics can be saved.")
          if (
            !topic.planConfirmed &&
            learning.phase !== "awaiting_plan_confirmation"
          )
            throw new Error(
              "Wait for the learner to confirm the proposed plan.",
            )
          if (
            !learning.notes.trim() ||
            !learning.workpad.trim() ||
            !learning.nextAction.trim()
          )
            throw new Error(
              "Notes, a private handoff, and a concrete next action are required.",
            )
          validateTopicDirectory(learning.notes)
          topicUpdates.set(topicId, learning)
          activity(`Saving ${topic.title} notes`)
          result = `Study notes for ${topic.title} staged. Save the chat handoff with save_learning_state before the final reply.`
        } else if (name === "save_learning_state") {
          saved = undefined
          const candidate = LearningStateSchema.parse(input)
          if (!candidate.workpad.trim() || !candidate.nextAction.trim())
            throw new Error(
              "A private handoff and a concrete next action are required.",
            )
          saved = candidate
          saveError = undefined
          activity("Saving the chat handoff")
          result =
            "Chat handoff staged. Provide the learner-facing lesson/question/choice now. The harness will atomically save and verify it before displaying your reply."
        } else {
          throw new Error("This tool is not available.")
        }
      } catch (error) {
        success = false
        result = `Tool error: ${error instanceof Error ? error.message : "Invalid tool arguments."}`
        if (name === "save_learning_state" || name === "save_topic_state")
          saveError = result
      }
      return { text: result, images: sourceImages, success }
    },
    get saved() {
      return saved !== undefined
    },
    get saveError() {
      return saveError
    },
    finish(reply: string) {
      if (!saved)
        throw new Error(
          saveError ??
            "The runner did not save a complete learning state. Retry this turn.",
        )
      if (!reply.trim())
        throw new Error("The runner returned no lesson. Retry this turn.")
      const states = [saved, ...topicUpdates.values()]
      for (const state of states) {
        const pendingKey = state.privateAnswerKey.trim()
        if (
          state.phase === "awaiting_answer" &&
          pendingKey.length > 20 &&
          states.some(
            (other) => reply.includes(pendingKey) || other.notes.includes(pendingKey),
          )
        )
          throw new Error(
            "The runner included a private assessment key in the lesson. Retry with a different runner.",
          )
      }
      return {
        reply,
        learning: saved,
        topicUpdates: [...topicUpdates].map(([topicId, learning]) => ({
          topicId,
          learning,
        })),
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
  for (let iteration = 0; iteration < 16; iteration++) {
    activity("Preparing your lesson")
    diagnostic("model.request", {
      iteration: iteration + 1,
      model: job.runner.model,
    })
    const completion = await client.chat.completions.create({
      model: job.runner.model,
      messages,
      tools: session.tools,
      max_completion_tokens: 12_000,
      stream: false,
    })
    const response = completion.choices[0]?.message
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
      iteration: iteration + 1,
      finishReason: completion.choices[0].finish_reason,
      toolCalls: response.tool_calls?.length ?? 0,
      replyCharacters: response.content?.length ?? 0,
      saved: session.saved,
    })
    if (!response.tool_calls?.length) {
      if (!session.saved) {
        messages.push({
          role: "user",
          content:
            "Save the complete learning state with save_learning_state, then provide the learner-facing reply.",
        })
        continue
      }
      return session.finish(response.content ?? "")
    }
    const sourceImages: ChatCompletionContentPart[] = []
    for (const call of response.tool_calls) {
      if (call.type !== "function")
        throw new Error("The model requested an unsupported tool.")
      diagnostic("tool.call", { tool: call.function.name })
      let input: Parameters<typeof LearningStateSchema.parse>[0]
      try {
        input = JSON.parse(call.function.arguments)
      } catch {
        diagnostic("tool.result", {
          tool: call.function.name,
          success: false,
          error: "Invalid JSON arguments",
        })
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Tool error: Invalid JSON arguments.",
        })
        continue
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
  }
  throw new Error(
    "The runner reached its tool limit. Retry with a narrower request.",
  )
}
