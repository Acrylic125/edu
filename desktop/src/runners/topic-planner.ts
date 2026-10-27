import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { load } from "cheerio"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { z } from "zod"
import type { WorkerJob } from "../shared/contracts"
import { DocumentSectionSchema } from "../shared/document-index"
import { ScratchpadNameSchema, TopicPartSchema, TopicReferenceSchema } from "../shared/topic-state"
import { RoleJobSchema, RoleSummarySchema } from "../shared/tutor-workflow"
import { extractMaterial, indexDocument, materialDigest } from "../main/material-extraction"
import { createTutorSession } from "./tutor"
import { readSkillCatalog, teachingSkills } from "./tutor-skills"

const SelectSectionsSchema = z.object({ sectionIds: z.array(DocumentSectionSchema.shape.id).min(1).max(100), includeVisuals: z.boolean().default(false) }).strict()
const SubmitPlanSchema = z.object({
  title: ScratchpadNameSchema,
  sections: z.array(z.object({ sectionId: DocumentSectionSchema.shape.id, name: TopicPartSchema.shape.name.optional(), goals: TopicPartSchema.shape.goals.max(3) }).strict()).min(1).max(100),
}).strict()
const WebSourceSchema = z.object({ url: z.url({ protocol: /^https?$/ }) }).strict()
const ClarificationSchema = z.object({ question: z.string().trim().min(1).max(2000) }).strict()

export async function createTopicPlannerSession(job: WorkerJob, role: z.infer<typeof RoleJobSchema>, persist: Parameters<typeof createTutorSession>[3], activity: (message: string) => void) {
  const available = [...new Map([
    ...job.chat.materials.map((material) => [material.id, { material, directory: job.assetDirectory }] as const),
    ...job.scratchpads.flatMap((scratchpad) => scratchpad.materials.map((material) => [material.id, { material, directory: scratchpad.assetDirectory }] as const)),
    ...job.workspaceScratchpads.flatMap((scratchpad) => (scratchpad.materials ?? []).map((material) => [material.id, { material, directory: scratchpad.assetDirectory ?? job.assetDirectory }] as const)),
  ]).values()].filter(({ material }) => role.request.context.materialIds.includes(material.id))
  const practiceIds = new Set(available.filter(({ material }) => /tutorial|worksheet|problem[ _-]*set|practice[ _-]*sheet|assignment/i.test(`${material.name}\n${(material.pages[0] ?? material.text).slice(0, 250)}`)).map(({ material }) => material.id))
  const indexed = available.map((source) => ({ ...source, practice: practiceIds.has(source.material.id) }))
  for (const source of indexed) {
    if (source.practice) {
      continue
    }
    let material = source.material
    const extension = extname(material.name).toLowerCase()
    let bytes: Buffer
    try { bytes = await readFile(join(source.directory, material.name)) } catch (error) {
      if (!(material.kind === "text" && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      bytes = Buffer.from(material.text)
    }
    const digest = materialDigest(bytes, extension)
    if (material.documentIndex?.digest !== digest) {
      if (material.documentIndex || material.kind === "image" || (material.kind === "pdf" && material.pages.some((page) => page.trim().length < 80))) {
        activity("Indexing source headings")
        const extracted = await extractMaterial(bytes, extension, job.sourceCacheDirectory ?? join(dirname(job.assetDirectory), "source-cache"))
        material = { ...material, ...extracted }
      } else {
        material = { ...material, documentIndex: indexDocument(digest, material.pages.length ? material.pages : [material.text], material.name) }
      }
    }
    const practice = /tutorial|worksheet|problem[ _-]*set|practice[ _-]*sheet|assignment/i.test(`${material.name}\n${(material.pages[0] ?? material.text).slice(0, 250)}`)
    source.material = material
    source.practice = practice
  }
  const curriculum = indexed.filter((source) => !source.practice)
  const indexedJob = structuredClone(job)
  const replaceMaterial = (material: WorkerJob["chat"]["materials"][number]) => indexed.find((source) => source.material.id === material.id)?.material ?? material
  indexedJob.chat.materials = indexedJob.chat.materials.map(replaceMaterial)
  for (const scratchpad of indexedJob.scratchpads) scratchpad.materials = scratchpad.materials.map(replaceMaterial)
  for (const scratchpad of indexedJob.workspaceScratchpads) scratchpad.materials = scratchpad.materials?.map(replaceMaterial)
  const skillPaths = ["skills/MANAGE_TOPIC.md", ...teachingSkills,
    "scratchpad_templates/topic/schema.md", "scratchpad_templates/topic/tools.md", "scratchpad_templates/topic/scratchpad_topic.md"]
  const base = await createTutorSession(indexedJob, activity, undefined, { ...persist, skillPaths })
  const management = await readFile(join(job.skillDirectory, "skills/MANAGE_TOPIC.md"), "utf8")
  const catalog = await readSkillCatalog(job.skillDirectory, teachingSkills)
  const sections = new Map<string, { section: z.infer<typeof DocumentSectionSchema>; reference: z.infer<typeof TopicReferenceSchema>; materialId?: string; text?: string }>()
  for (const { material } of curriculum) {
    for (const section of material.documentIndex?.sections ?? []) {
      let reference: z.infer<typeof TopicReferenceSchema>
      if (material.kind === "pdf") reference = { type: "pdf", path: `assets/${material.name}`, pages: [{ from: section.firstPage, to: section.lastPage }] }
      else if (material.name.toLowerCase().endsWith(".pptx")) reference = { type: "ppt", path: `assets/${material.name}`, pages: [{ from: section.firstPage, to: section.lastPage }] }
      else if (material.kind === "image") reference = { type: "image", path: `assets/${material.name}` }
      else reference = { type: "other-file", path: `assets/${material.name}` }
      sections.set(section.id, { section, reference, materialId: material.id })
    }
  }
  const reviewed = new Set<string>()
  const completion = Promise.withResolvers<void>()
  let output: z.infer<typeof RoleSummarySchema> | undefined
  let errorMessage: string | undefined
  let webReads = 0
  const tools: ChatCompletionTool[] = [
    { type: "function", function: { name: "read_skill", description: "Read a topic role skill or reference when needed.", parameters: z.toJSONSchema(z.object({ path: z.enum(skillPaths) })) } },
    { type: "function", function: { name: "select_topic_sections", description: "Read indexed curriculum sections in one batch. Supply only the IDs needed for the requested scope. The host supplies their text and records source evidence. Request images only to resolve ambiguous headings or figures.", parameters: z.toJSONSchema(SelectSectionsSchema) } },
    { type: "function", function: { name: "inspect_web_source", description: "Fetch and inspect an actual source page after native web search. Returns a host-issued section ID and its content. Use that ID in the plan. A URL from search results alone cannot be cited.", parameters: z.toJSONSchema(WebSourceSchema) } },
    { type: "function", function: { name: "submit_topic_plan", description: "Save the proposed curriculum using reviewed section IDs. The host constructs part IDs, file paths, page ranges, and citations. No reference fields are accepted. This ends planning immediately; the host presents confirmation after commit.", parameters: z.toJSONSchema(SubmitPlanSchema) } },
    { type: "function", function: { name: "request_topic_clarification", description: "Return a specific missing scope or source question without creating a topic.", parameters: z.toJSONSchema(ClarificationSchema) } },
  ]
  const session = {
    ...base,
    completion: completion.promise,
    tools,
    instructions: `Create a curriculum for the learner's request. This invocation identifies scope, reads the needed sources, and submits the plan. If the subject or scope is unclear, use request_topic_clarification before creating anything.
${management}
Read the relevant general skill on demand. Skill catalog: ${JSON.stringify(catalog)}
Topic references available through read_skill: ${JSON.stringify(skillPaths.filter((path) => !path.startsWith("skills/")))}
Task: ${role.request.task}
Context: ${role.request.context.relevantContext}
Indexed curriculum sections: ${JSON.stringify([...sections.values()].map(({ section, materialId }) => ({ ...section, materialId })))}
Practice attachments retained automatically: ${JSON.stringify(indexed.filter((source) => source.practice).map(({ material }) => ({ name: material.name, pageCount: material.pages.length || 1 })))}
Select the requested section IDs together with select_topic_sections. Preserve their source order, headings, and continuation ranges. Do not navigate by guessing page numbers or spawn section readers. OCR is a navigation aid; inspect source images if a heading is unclear. Do not inspect or cite deferred practice attachments just to preserve them.
If no suitable curriculum source is supplied, use native web search, then inspect_web_source for candidate official documentation, textbooks, university materials, or primary publications. Use at most two search rounds. If sources remain unavailable, ask a focused clarification.
Submit a concise plan with submit_topic_plan: title, selected section IDs, and one or two essential learning goals per section with concise understoodWhen criteria. Use a name override only to clarify a source heading. The host owns references and page ranges. Do not generate questions, answer keys, worked lessons, a handoff, or a final learner reply. These belong to teaching after confirmation.`,
    async readMessageImages() { return [] },
    async execute(name: string, input: Parameters<typeof base.execute>[1]) {
      try {
        if (output) throw new Error("Planning has ended.")
        if (name === "read_skill") return base.execute(name, input)
        if (name === "select_topic_sections") {
          const { sectionIds, includeVisuals } = SelectSectionsSchema.parse(input)
          const selected = sectionIds.map((id) => {
            const source = sections.get(id)
            if (!source) throw new Error("Select a host-issued curriculum section ID.")
            return source
          })
          const text: string[] = []
          const images: Awaited<ReturnType<typeof base.readMessageImages>> = []
          for (const source of selected) {
            if (source.text) { text.push(source.text); continue }
            if (!source.materialId) throw new Error("This indexed source has no content.")
            const chunkSize = includeVisuals ? 3 : 15
            for (let firstPage = source.section.firstPage; firstPage <= source.section.lastPage; firstPage += chunkSize) {
              const result = await base.execute("read_material", { id: source.materialId, firstPage, lastPage: Math.min(firstPage + chunkSize - 1, source.section.lastPage), includeVisuals })
              if (!result.success) throw new Error(result.text)
              text.push(`Section ${source.section.id}: ${source.section.title}\n${result.text}`)
              images.push(...result.images)
            }
          }
          if (text.join("\n").length > 120_000) throw new Error("The selected content is too large. Narrow the requested scope.")
          for (const id of sectionIds) reviewed.add(id)
          return { success: true, text: text.join("\n\n"), images }
        }
        if (name === "inspect_web_source") {
          if (++webReads > 8) throw new Error("Source inspection reached its limit. Ask about the remaining coverage gap.")
          const { url } = WebSourceSchema.parse(input)
          if (new URL(url).username || new URL(url).password) throw new Error("Use a source URL without credentials.")
          const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
          if (!response.ok || !response.body) throw new Error("This source could not be retrieved. Try another authoritative source.")
          const contentType = response.headers.get("content-type") ?? ""
          if (contentType && !/text\/(?:html|plain)|application\/xhtml\+xml/i.test(contentType)) {
            await response.body.cancel()
            throw new Error("This source is not a readable web page. Attach document sources for indexing, or inspect another page.")
          }
          const chunks: Uint8Array[] = []
          let size = 0
          const reader = response.body.getReader()
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              size += value.length
              if (size > 2_000_000) {
                await reader.cancel()
                throw new Error("This source is too large. Use a specific section page.")
              }
              chunks.push(value)
            }
          } finally {
            reader.releaseLock()
          }
          const body = Buffer.concat(chunks).toString("utf8")
          const $ = load(body)
          $("script, style, nav, header, footer").remove()
          const title = $("title").first().text().trim().slice(0, 200) || response.url || url
          const text = ($("main").text() || $("body").text()).replace(/\s+/g, " ").trim()
          if (text.length < 80) throw new Error("This page has insufficient readable content. Inspect another source.")
          const canonical = response.url || url
          const digest = createHash("sha256").update(canonical).update(text).digest("hex")
          const section = DocumentSectionSchema.parse({ id: `section-${digest.slice(0, 16)}-1`, title, firstPage: 1, lastPage: 1 })
          sections.set(section.id, { section, reference: { type: "website", url: canonical }, text: text.slice(0, 30_000) })
          reviewed.add(section.id)
          return { success: true, text: JSON.stringify({ section, url: canonical, content: text.slice(0, 30_000) }), images: [] }
        }
        if (name === "request_topic_clarification") {
          const { question } = ClarificationSchema.parse(input)
          output = { summary: question, evidence: [], needsClarification: true }
          completion.resolve()
          return { success: true, text: "Clarification ready.", images: [] }
        }
        if (name !== "submit_topic_plan") throw new Error("Use indexed section selection and submit_topic_plan. Raw topic writes and page references are unavailable during planning.")
        const plan = SubmitPlanSchema.parse(input)
        if (new Set(plan.sections.map((section) => section.sectionId)).size !== plan.sections.length) throw new Error("Each indexed section can appear only once in the plan.")
        const content = plan.sections.map((part, index) => {
          const source = sections.get(part.sectionId)
          if (!source || !reviewed.has(part.sectionId)) throw new Error("Read the selected section before including it in the plan.")
          return { id: `tp-section-${index + 1}`, name: part.name ?? source.section.title, references: [source.reference], goals: part.goals, mistakes: [] }
        })
        let result
        if (role.mode === "create") result = await base.execute("topic_createTopic", { scratchpad: { type: "topic", version: "11-10-2026", name: plan.title, content } })
        else result = await base.execute("topic_updateTopic", { scratchpadId: role.scratchpadHandle, name: plan.title, content })
        if (!result.success) throw new Error(result.text)
        output = { summary: "Topic plan ready for learner confirmation.", evidence: content.flatMap((part) => part.references) }
        errorMessage = undefined
        completion.resolve()
        return { success: true, text: "Plan staged. The host will commit and present it for confirmation.", images: [] }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Invalid planning operation."
        return { success: false, text: errorMessage, images: [] }
      }
    },
    get saved() { return output !== undefined },
    get saveError() { if (!output) return errorMessage },
    hasReply() { return output !== undefined },
    previewReply() { return "" },
    recoveryMessage() { return `${errorMessage ?? "The plan is incomplete."} Select and read valid indexed sections, then use submit_topic_plan. If scope or sources are missing, use request_topic_clarification. No handoff or final reply is needed.` },
    finish() {
      if (!output) throw new Error("The planner did not submit a plan or clarification.")
      return { reply: output.summary, learning: indexedJob.chat.learning, scratchpadUpdates: [], scratchpadMutations: [] }
    },
  }
  return { job: indexedJob, session, get output() { return output } }
}
